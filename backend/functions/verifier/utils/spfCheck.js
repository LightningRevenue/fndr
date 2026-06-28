const dns = require('dns/promises');

/**
 * @typedef {'google'|'microsoft'|'yahoo'|'amazon_ses'|'sendgrid'|'mailgun'|'zoho'|'protonmail'|'unknown'} SPFProvider
 * @typedef {'high'|'medium'|'low'} SPFConfidence
 *
 * @typedef {Object} SPFResult
 * @property {SPFProvider} provider
 * @property {string} raw
 * @property {SPFConfidence} confidence
 */

/** @type {Array<{patterns: string[], provider: SPFProvider}>} */
const PROVIDER_PATTERNS = [
    { patterns: ['google.com', '_spf.google.com'],                               provider: 'google' },
    { patterns: ['outlook.com', 'protection.outlook.com', 'spf.protection.outlook.com'], provider: 'microsoft' },
    { patterns: ['yahoo.com', '_spf.mail.yahoo.com'],                            provider: 'yahoo' },
    { patterns: ['amazonses.com', 'amazon.com'],                                 provider: 'amazon_ses' },
    { patterns: ['sendgrid.net'],                                                 provider: 'sendgrid' },
    { patterns: ['mailgun.org'],                                                  provider: 'mailgun' },
    { patterns: ['zoho.com'],                                                     provider: 'zoho' },
    { patterns: ['protonmail.ch', '_spf.protonmail.ch'],                         provider: 'protonmail' },
];

/**
 * Parse SPF TXT record to detect mail provider
 * @param {string} domain
 * @returns {Promise<SPFResult>}
 */
async function checkSPF(domain) {
    /** @type {SPFResult} */
    let result = { provider: 'unknown', raw: '', confidence: 'low' };

    try {
        // DNS TXT lookup with 8s timeout
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);

        /** @type {string[][]} */
        let records = [];
        try {
            records = await dns.resolveTxt(domain);
        } finally {
            clearTimeout(timer);
        }

        // Flatten and find SPF record
        const spfRecord = records
            .map(parts => parts.join(''))
            .find(r => r.startsWith('v=spf1'));

        if (!spfRecord) {
            return result; // no SPF — confidence stays 'low'
        }

        result.raw = spfRecord;
        result.confidence = 'medium'; // SPF exists but no known provider yet

        // Check for known provider patterns in includes/redirects
        for (const { patterns, provider } of PROVIDER_PATTERNS) {
            const matched = patterns.some(p => spfRecord.includes(p));
            if (matched) {
                result.provider = provider;
                result.confidence = 'high';
                break;
            }
        }
    } catch (_) {
        // DNS failure — defaults already set (unknown, low)
    } finally {
        return result;
    }
}

module.exports = { checkSPF };
