/**
 * Find email by name + domain (hunter.io style)
 * Streams each pattern result via SSE as soon as it's verified
 */

const { v4: uuidv4 } = require('uuid');
const queue = require('../../staging/queue');
const controller = require('../../verifier/controller');
const categoryFromEmailData = require('../../verifier/utils/categoryFromEmailData');
const getMXRecords = require('../../verifier/utils/getMXRecords');
const MXOrganizationClassifier = require('../../verifier/utils/mxOrganizationClassifier');
const MXProcessingProfiles = require('../../verifier/utils/mxProcessingProfiles');
const { createVerificationRequest, updateVerificationStatus, saveValidEmails } = require('./verificationDB');

const _mxClassifier = new MXOrganizationClassifier();
const _mxProfiles = new MXProcessingProfiles();

/**
 * Look up MX for domain and return { batchSize, delayMs, profile }
 * @param {string} domain
 * @returns {Promise<{batchSize: number, delayMs: number, profile: string}>}
 */
async function getRateLimitConfig(domain) {
    try {
        // Use a dummy email just for MX lookup
        const mxRecords = await getMXRecords(`probe@${domain}`);
        if (!mxRecords || mxRecords.length === 0) {
            // No MX → ultra conservative, probably won't work anyway
            return { batchSize: 1, delayMs: 3000, profile: 'unknown_mx_ultra_conservative' };
        }

        const primaryMX = mxRecords.reduce((a, b) => (a.priority <= b.priority ? a : b));
        const classification = _mxClassifier.classifyMXDomain(primaryMX.exchange);
        const config = _mxProfiles.getProcessingConfig(classification.processingProfile);

        return {
            batchSize: Math.max(1, Math.min(config.parallelConnections ?? 2, 4)),
            delayMs: config.delayBetweenBatches ?? 1000,
            profile: classification.processingProfile,
        };
    } catch (_) {
        return { batchSize: 1, delayMs: 2000, profile: 'unknown_mx_conservative' };
    }
}

// 26 patterns ordered by hit-rate (P1 → P4)
const EMAIL_PATTERNS = [
    // P1 ~65% — most common
    (f, l) => `${f}.${l}`,           // john.smith
    (f, l) => `${f[0]}${l}`,         // jsmith
    (f, l) => `${f}${l}`,            // johnsmith
    (f, l) => `${f}`,                // john

    // P2 ~20%
    (f, l) => `${f[0]}.${l}`,        // j.smith
    (f, l) => `${f}_${l}`,           // john_smith
    (f, l) => `${f}-${l}`,           // john-smith
    (f, l) => `${l}`,                // smith

    // P3 ~10%
    (f, l) => `${l}.${f}`,           // smith.john
    (f, l) => `${f}${l[0]}`,         // johns
    (f, l) => `${f[0]}_${l}`,        // j_smith
    (f, l) => `${f[0]}-${l}`,        // j-smith
    (f, l) => `${f}.${l[0]}`,        // john.s
    (f, l) => `${f}_${l[0]}`,        // john_s
    (f, l) => `${f}-${l[0]}`,        // john-s
    (f, l) => `${l}${f[0]}`,         // smithj
    (f, l) => `${l}.${f[0]}`,        // smith.j

    // P4 ~5% — reversed, separators, initials, numbers
    (f, l) => `${l}_${f}`,           // smith_john
    (f, l) => `${l}-${f}`,           // smith-john
    (f, l) => `${l}${f}`,            // smithjohn
    (f, l) => `${f[0]}${l[0]}`,      // js
    (f, l) => `${f[0]}.${l[0]}`,     // j.s
    (f, l) => `${f[0]}_${l[0]}`,     // j_s
    (f, l) => `${f}.${l}1`,          // john.smith1
    (f, l) => `${f[0]}${l}1`,        // jsmith1
    (f, l) => `${f}.${l}2`,          // john.smith2
];

/**
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string} email
 * @returns {Promise<{status: string, reason: string} | null>}
 */
async function verifySingleViaQueue(email) {
    try {
        const id = `find-${uuidv4()}`;

        const createResult = await createVerificationRequest({
            verification_request_id: id,
            request_type: 'single',
            emails: [email],
        });
        if (!createResult.success) return null;

        const queueResult = await queue.add({ request_id: id, emails: [email], response_url: '' });
        if (!queueResult.success) return null;

        await updateVerificationStatus(id, 'processing');

        const MAX_WAIT_MS = 45_000;
        const POLL_INTERVAL_MS = 200;
        const start = Date.now();

        while (Date.now() - start < MAX_WAIT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const status = await controller.getRequestStatus(id);
            if (status?.status === 'completed') {
                const results = status.results;
                if (Array.isArray(results) && results.length > 0) {
                    const r = results[0];
                    // results[] are raw VerificationObj — run through categoryFromEmailData
                    const categorized = categoryFromEmailData(r);
                    if (categorized) {
                        return { status: categorized.status, reason: categorized.reason };
                    }
                    // fallback: already transformed format (has .status/.message)
                    return { status: r.status || 'unknown', reason: r.message || '' };
                }
                return null;
            }
            if (status?.status === 'failed') return null;
        }

        return null;
    } catch (error) {
        console.error('verifySingleViaQueue error:', error instanceof Error ? error.message : String(error));
        return null;
    }
}

/**
 * GET /api/verifier/find-email?firstName=&lastName=&domain=
 * SSE stream — sends one event per pattern as it completes
 *
 * Event types:
 *   attempt  { email, status, reason, pattern }
 *   found    { email, status, reason }
 *   done     { found: false }
 *   error    { message }
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function findEmail(req, res) {
    const { firstName, lastName, domain } = req.query;

    if (!firstName || !lastName || !domain ||
        typeof firstName !== 'string' || typeof lastName !== 'string' || typeof domain !== 'string') {
        res.status(400).json({ success: false, message: 'firstName, lastName and domain are required' });
        return;
    }

    const f = normalizeName(firstName);
    const l = normalizeName(lastName);
    const d = domain.toLowerCase().trim().replace(/^@/, '');

    if (!f || !l || !d) {
        res.status(400).json({ success: false, message: 'Name parts or domain are empty after normalization' });
        return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    /** @param {string} event @param {object} data */
    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Build unique candidate list
    const seen = new Set();
    /** @type {string[]} */
    const candidates = [];
    for (const pattern of EMAIL_PATTERNS) {
        const local = pattern(f, l);
        const email = `${local}@${d}`;
        if (!seen.has(email)) {
            seen.add(email);
            candidates.push(email);
        }
    }

    let clientGone = false;
    req.on('close', () => { clientGone = true; });

    // Determine batch size + inter-batch delay from MX provider profile
    const { batchSize, delayMs, profile } = await getRateLimitConfig(d);
    console.debug(`findEmail rate config for ${d}: profile=${profile} batch=${batchSize} delay=${delayMs}ms`);
    send('config', { profile, batchSize, delayMs });

    try {
        let foundValid = false;

        /** @type {{email: string, pattern: string}[]} */
        const greylistRetry = [];

        for (let i = 0; i < candidates.length && !foundValid && !clientGone; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);

            // Run batch in parallel, collect results in order
            const results = await Promise.all(
                batch.map(email => verifySingleViaQueue(email))
            );

            // ponytail: if entire batch is unverifiable (4xx, timeout, etc), server is unreachable — stop early
            const allUnreachable = results.every(r =>
                r?.status === 'unverifiable' && (
                    /4\d\d/.test(r?.reason ?? '') ||
                    /timeout/i.test(r?.reason ?? '') ||
                    /timed out/i.test(r?.reason ?? '')
                )
            );
            if (allUnreachable && batch.length > 1) {
                for (let j = 0; j < batch.length; j++) {
                    const email = batch[j];
                    const result = results[j];
                    send('attempt', { email, status: result?.status ?? 'unverifiable', reason: result?.reason ?? '', pattern: email.split('@')[0] });
                }
                send('done', { found: false, blocked: true, message: 'Mail server is rate-limiting connections — try again later.' });
                res.end();
                return;
            }

            for (let j = 0; j < batch.length; j++) {
                if (clientGone) break;

                const email = batch[j];
                const result = results[j];
                const status = result?.status ?? 'unknown';
                const reason = result?.reason ?? 'Verification failed';

                send('attempt', { email, status, reason, pattern: email.split('@')[0] });

                if (status === 'valid') {
                    saveValidEmails([{ email, status: 'valid', message: reason }], 'single', { firstName, lastName });
                    send('found', { email, status, reason });
                    foundValid = true;
                    break;
                }

                // Track greylisted candidates for retry
                if (
                    status === 'unverifiable' &&
                    /greylist|greylisting|temporarily deferred|try again later|451/i.test(reason)
                ) {
                    greylistRetry.push({ email, pattern: email.split('@')[0] });
                }
            }

            // Inter-batch delay to respect provider rate limits
            const hasMore = i + batchSize < candidates.length;
            if (!foundValid && !clientGone && hasMore && delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        // Retry greylisted candidates once after 8s delay (sequential — greylist servers are sensitive)
        if (greylistRetry.length > 0 && !foundValid && !clientGone) {
            send('info', { message: `Retrying ${greylistRetry.length} greylisted address(es)...` });
            await new Promise(r => setTimeout(r, 8000));

            for (const { email, pattern } of greylistRetry) {
                if (clientGone || foundValid) break;

                const result = await verifySingleViaQueue(email);
                const status = result?.status ?? 'unknown';
                const reason = result?.reason ?? 'Verification failed';

                send('attempt', { email, status, reason, pattern });

                if (status === 'valid') {
                    saveValidEmails([{ email, status: 'valid', message: reason }], 'single', { firstName, lastName });
                    send('found', { email, status, reason });
                    foundValid = true;
                }
            }
        }

        if (!foundValid && !clientGone) send('done', { found: false });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('findEmail SSE error:', msg);
        if (!clientGone) send('error', { message: 'Internal server error' });
    } finally {
        res.end();
        console.debug('findEmail process completed');
    }
}

module.exports = { findEmail };
