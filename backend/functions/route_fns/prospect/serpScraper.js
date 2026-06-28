/**
 * Company owner finder — multi-engine SERP scraping
 * Tries Bing HTML (less bot-aggressive) then DDG, with User-Agent rotation
 * Extracts owner names from LinkedIn titles, snippets, and Romanian business sites
 */

'use strict';

const https = require('https');


/**
 * @typedef {Object} SERPResult
 * @property {string} title
 * @property {string} snippet
 * @property {string} url
 */

/**
 * @typedef {Object} OwnerResult
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} source
 * @property {'high'|'medium'|'low'} confidence
 */


// Rotate through realistic desktop UAs to avoid fingerprinting
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

let _uaIndex = 0;
function nextUA() {
    const ua = USER_AGENTS[_uaIndex % USER_AGENTS.length];
    _uaIndex++;
    return ua;
}

const MIN_NAME_PART = 2;

// Romanian diacritics-aware capitalized word pattern
const CAP_WORD = '[A-ZĂÂÎȘȚ][a-zăâîșț\\-]+';
const FULL_NAME_RE = new RegExp(`(${CAP_WORD}(?:\\s${CAP_WORD}){1,3})`);
const CAPS_NAME_RE = /\b([A-ZĂÂÎȘȚ]{2,}(?:\s[A-ZĂÂÎȘȚ]{2,}){1,3})\b/;

const LINKEDIN_TITLE_RE = /^([A-ZĂÂÎȘȚÀ-ɏ][a-zăâîșțÀ-ɏ\-]+(?:\s[A-ZĂÂÎȘȚÀ-ɏ][a-zăâîșțÀ-ɏ\-]+)+)\s*[-–|]\s*(?:CEO|Fondator|Director|Owner|Administrator|Managing Director|Co-Founder|Președinte|Manager General|CTO|COO|Proprietar)/i;
const SNIPPET_ROLE_RE = /(?:administrator|fondator|director general|owner|CEO|manager general|proprietar)\s*:?\s*([A-ZĂÂÎȘȚÀ-ɏ][a-zăâîșțÀ-ɏ\-]+\s+[A-ZĂÂÎȘȚÀ-ɏ][a-zăâîșțÀ-ɏ\-]+)/i;


/**
 * HTTPS GET with one redirect follow and timeout
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<string>}
 */
function httpGet(url, headers) {
    return new Promise((resolve, reject) => {
        try {
            const opts = { headers };

            const req = https.get(url, opts, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                    const loc = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : `https://www.bing.com${res.headers.location}`;
                    const req2 = https.get(loc, opts, (res2) => {
                        let d = '';
                        res2.on('data', (c) => { d += c; });
                        res2.on('end', () => resolve(d));
                    }).on('error', reject);
                    req2.setTimeout(12000, () => { req2.destroy(); reject(new Error('timeout')); });
                    return;
                }
                let d = '';
                res.on('data', (c) => { d += c; });
                res.on('end', () => resolve(d));
            }).on('error', reject);

            req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
        } catch (err) {
            reject(err);
        }
    });
}


/**
 * Detect if response is a bot-challenge page (not real results)
 * @param {string} html
 * @returns {boolean}
 */
function isBotChallenge(html) {
    return (
        html.length < 20000 &&
        (
            /anomaly\.js|challenge-form|cc=botnet|captcha|robot|unusual traffic|automated query/i.test(html) ||
            // Bing: "To continue, please type the characters below"
            /type the characters|verify you are human|access denied/i.test(html)
        )
    );
}


/**
 * Strip HTML tags
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}


/**
 * Parse Bing HTML SERP into structured results
 * Bing result structure: <li class="b_algo"> with <h2><a href> and <p class="b_paractl"> or <div class="b_caption"><p>
 * @param {string} html
 * @returns {SERPResult[]}
 */
function parseBingResults(html) {
    /** @type {SERPResult[]} */
    const results = [];
    try {
        // Each organic result: <li class="b_algo">...<h2><a href="URL">TITLE</a></h2>...<p>SNIPPET</p>
        const blockRe = /<li[^>]+class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
        let bm;
        while ((bm = blockRe.exec(html)) !== null && results.length < 10) {
            const block = bm[1];
            const titleM = /<h2[^>]*>\s*<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
            if (!titleM) continue;
            const snippetM = /<p[^>]*class="[^"]*b_para[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)
                          || /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
                          || /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
            results.push({
                url: titleM[1],
                title: stripTags(titleM[2]),
                snippet: snippetM ? stripTags(snippetM[1]) : '',
            });
        }
    } catch (err) {
        console.error('[SERP] parseBingResults error:', err instanceof Error ? err.message : String(err));
    }
    return results;
}


/**
 * Parse DDG HTML SERP into structured results
 * @param {string} html
 * @returns {SERPResult[]}
 */
function parseDDGResults(html) {
    /** @type {SERPResult[]} */
    const results = [];
    try {
        let m;
        const blockRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;
        while ((m = blockRe.exec(html)) !== null && results.length < 10) {
            results.push({ url: m[1], title: stripTags(m[2]), snippet: stripTags(m[3]) });
        }

        if (results.length === 0) {
            const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
            const titles = [];
            while ((m = titleRe.exec(html)) !== null) titles.push({ url: m[1], title: stripTags(m[2]) });
            const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;
            const snippets = [];
            while ((m = snippetRe.exec(html)) !== null) {
                const t = stripTags(m[1]);
                if (t.length > 10) snippets.push(t);
            }
            for (let i = 0; i < Math.min(10, titles.length); i++) {
                results.push({ title: titles[i].title, snippet: snippets[i] || '', url: titles[i].url });
            }
        }
    } catch (err) {
        console.error('[SERP] parseDDGResults error:', err instanceof Error ? err.message : String(err));
    }
    return results;
}


/**
 * Fetch Bing HTML for a query
 * @param {string} query
 * @returns {Promise<string>}
 */
function fetchBing(query) {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bing.com/search?q=${encoded}&setlang=ro&cc=RO&count=10`;
    return httpGet(url, {
        'User-Agent': nextUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.bing.com/',
    });
}


/**
 * Fetch DDG HTML for a query
 * @param {string} query
 * @returns {Promise<string>}
 */
function fetchDDG(query) {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}&kl=ro-ro`;
    return httpGet(url, {
        'User-Agent': nextUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Referer': 'https://duckduckgo.com/',
    });
}


/**
 * Fetch SERP HTML, trying Bing first then DDG as fallback
 * Returns { html, engine } or null if both are bot-challenged
 * @param {string} query
 * @returns {Promise<{html: string, engine: string} | null>}
 */
async function fetchSERP(query) {
    try {
        const bingHtml = await fetchBing(query);
        if (!isBotChallenge(bingHtml)) {
            console.log(`[SERP] Bing OK for query (${bingHtml.length} bytes)`);
            return { html: bingHtml, engine: 'bing' };
        }
        console.log(`[SERP] Bing bot-challenged, trying DDG...`);
    } catch (err) {
        console.log(`[SERP] Bing fetch failed: ${err instanceof Error ? err.message : String(err)}, trying DDG...`);
    }

    try {
        const ddgHtml = await fetchDDG(query);
        if (!isBotChallenge(ddgHtml)) {
            console.log(`[SERP] DDG OK for query (${ddgHtml.length} bytes)`);
            return { html: ddgHtml, engine: 'ddg' };
        }
        console.log(`[SERP] DDG also bot-challenged — both engines blocked`);
    } catch (err) {
        console.log(`[SERP] DDG fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return null;
}


/**
 * Parse SERP HTML based on which engine returned it
 * @param {string} html
 * @param {string} engine
 * @returns {SERPResult[]}
 */
function parseSERP(html, engine) {
    return engine === 'bing' ? parseBingResults(html) : parseDDGResults(html);
}


/**
 * Split a full name string into firstName + lastName
 * @param {string} fullName
 * @returns {{ firstName: string; lastName: string } | null}
 */
function splitName(fullName) {
    const parts = fullName.trim().split(/\s+/).filter((p) => p.length >= MIN_NAME_PART);
    if (parts.length < 2) return null;
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}


/**
 * Title-case an all-caps Romanian name
 * @param {string} raw
 * @returns {string}
 */
function titleCase(raw) {
    return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}


/**
 * Extract a person name from SERP results
 * @param {SERPResult[]} results
 * @returns {OwnerResult | null}
 */
function extractNameFromResults(results) {
    try {
        // High confidence — LinkedIn title pattern "Name - CEO at Company"
        for (const r of results) {
            const m = LINKEDIN_TITLE_RE.exec(r.title);
            if (m) {
                const parsed = splitName(m[1]);
                if (parsed) return { ...parsed, source: r.url, confidence: 'high' };
            }
        }

        // Medium confidence — role keyword in snippet or title
        for (const r of results) {
            const text = r.snippet || r.title;
            const m = SNIPPET_ROLE_RE.exec(text);
            if (m) {
                const parsed = splitName(m[1]);
                if (parsed) return { ...parsed, source: r.url, confidence: 'medium' };
            }
        }

        // Medium confidence — role keyword near a capitalized name in snippet
        for (const r of results) {
            const snippet = r.snippet || '';
            if (!/administrator|fondator|director|owner|CEO|proprietar/i.test(snippet)) continue;
            const nm = FULL_NAME_RE.exec(snippet);
            if (nm) {
                const parsed = splitName(nm[1]);
                if (parsed) return { ...parsed, source: r.url, confidence: 'medium' };
            }
        }

        // Low confidence — ONRC all-caps name pattern from termene/listafirme results
        for (const r of results) {
            const snippet = r.snippet || '';
            const m = CAPS_NAME_RE.exec(snippet);
            if (m) {
                const raw = titleCase(m[1]);
                const parsed = splitName(raw);
                if (parsed) return { ...parsed, source: r.url, confidence: 'low' };
            }
        }
    } catch (err) {
        console.error('[SERP] extractNameFromResults error:', err instanceof Error ? err.message : String(err));
    }

    return null;
}


/**
 * Build ordered search queries for a company — prioritized for finding owner names
 * @param {string} companyName
 * @param {string} domain
 * @returns {string[]}
 */
function buildSearchQueries(companyName, domain) {
    /** @type {string[]} */
    const queries = [
        // LinkedIn is the most reliable source for owner names
        `"${companyName}" Romania CEO OR Fondator OR Director site:linkedin.com`,
        // Romanian business registries often show administrator names
        `"${companyName}" administrator site:termene.ro`,
        `"${companyName}" administrator site:listafirme.ro`,
        // Generic Romanian search
        `"${companyName}" fondator OR administrator OR proprietar Romania`,
    ];

    if (domain) {
        // Company website "About/Echipa" page may list founders
        queries.splice(3, 0, `site:${domain} director OR fondator OR CEO OR echipa OR despre`);
    }

    return queries;
}


/**
 * Sleep helper
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Strip protocol / www from a URL and return bare domain
 * @param {string} website
 * @returns {string}
 */
function extractDomain(website) {
    try {
        return website
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(/\/.*$/, '')
            .toLowerCase()
            .trim();
    } catch (_) {
        return '';
    }
}


/**
 * Find the owner of a company by running SERP queries
 * Tries Bing first, DDG as fallback, rotates User-Agents
 * @param {string} companyName
 * @param {string} domain
 * @returns {Promise<OwnerResult | null>}
 */
async function findOwner(companyName, domain) {
    const queries = buildSearchQueries(companyName, domain);
    let consecutiveBlocked = 0;

    try {
        for (let i = 0; i < queries.length; i++) {
            if (i > 0) await sleep(2000);

            try {
                const fetched = await fetchSERP(queries[i]);

                if (!fetched) {
                    consecutiveBlocked++;
                    console.log(`[SERP] query #${i + 1}: both engines blocked (${consecutiveBlocked} consecutive)`);
                    // If 2 queries in a row are blocked, stop — IP is blocked for this session
                    if (consecutiveBlocked >= 2) {
                        console.log(`[SERP] stopping — IP blocked by all engines`);
                        break;
                    }
                    continue;
                }

                consecutiveBlocked = 0;
                const results = parseSERP(fetched.html, fetched.engine);
                console.log(`[SERP] query #${i + 1} via ${fetched.engine}: ${results.length} results`);
                console.log(`[SERP] titles:`, results.slice(0, 3).map(r => r.title).join(' | '));

                const owner = extractNameFromResults(results);
                if (owner) {
                    console.log(`[SERP] found owner via query #${i + 1}:`, owner);
                    return owner;
                }

                console.log(`[SERP] query #${i + 1}: no owner matched`);
            } catch (queryErr) {
                console.error(`[SERP] query ${i + 1} error:`, queryErr instanceof Error ? queryErr.message : String(queryErr));
            }
        }
    } finally {
        console.debug('findOwner completed for', companyName);
    }

    return null;
}


module.exports = { findOwner, extractDomain, buildSearchQueries };
