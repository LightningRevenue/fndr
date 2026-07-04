'use strict';

const axios = require('axios');

const SERP_ENDPOINT = 'https://api.brightdata.com/unblocker/req';
const CUSTOMER = 'hl_1bfe96c5';
const ZONE = 'serp_api1';

/**
 * Fetch Google SERP HTML via Bright Data unblocker
 * Bright Data returns async response_id — poll until HTML is ready
 * @param {string} googleUrl
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function fetchSerp(googleUrl, apiKey) {
    const res = await axios.post(
        `${SERP_ENDPOINT}?customer=${CUSTOMER}&zone=${ZONE}`,
        { url: googleUrl, flags: 'country-us', format: 'raw', render_js: false },
        {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
            responseType: 'text',
        }
    );

    const raw = String(res.data);

    // Sync response — got HTML directly
    if (raw.trimStart().startsWith('<')) return raw;

    // Async response — got { response_id }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return raw; }

    const responseId = parsed?.response_id;
    if (!responseId) return raw;

    // Poll for result — Bright Data stores async results at this endpoint
    const pollUrl = `https://api.brightdata.com/unblocker/req?customer=${CUSTOMER}&zone=${ZONE}&response_id=${responseId}`;
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await axios.get(pollUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
            responseType: 'text',
            validateStatus: (s) => s < 500,
        });
        if (poll.status === 200) {
            console.log('[LinkedInSearch] poll success after', (i + 1) * 2, 's');
            return String(poll.data);
        }
        console.log('[LinkedInSearch] poll attempt', i + 1, 'status:', poll.status);
    }

    throw new Error('Bright Data SERP timeout');
}

/**
 * Parse Google SERP HTML → array of LinkedIn profile results
 * @param {string} html
 * @returns {Array<{ name: string; title: string; url: string; snippet: string }>}
 */
function parseResults(html) {
    /** @type {Array<{ name: string; title: string; url: string; snippet: string }>} */
    const results = [];

    // Extract result blocks — each Google result has <div class="g">
    const blockRe = /<div[^>]+class="[^"]*\bg\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    let bm;

    while ((bm = blockRe.exec(html)) !== null && results.length < 10) {
        const block = bm[0];

        // URL — look for linkedin.com/in/
        const urlM = /href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"?#]+)"/i.exec(block);
        if (!urlM) continue;

        const url = urlM[1].replace(/\/$/, '');

        // Title from <h3>
        const titleM = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block);
        const rawTitle = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';

        // "Name - Role | LinkedIn" pattern
        const dashM = /^(.+?)\s*[-–]\s*(.+?)\s*(?:\|.*)?$/.exec(rawTitle);
        const name  = dashM ? dashM[1].trim() : rawTitle.replace(/\s*\|.*$/, '').trim();
        const title = dashM ? dashM[2].replace(/\s*\|.*$/, '').trim() : '';

        // Snippet
        const snippetM = /<div[^>]+class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
                      || /<span[^>]+class="[^"]*aCOpRe[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
        const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

        if (name) results.push({ name, title, url, snippet });
    }

    // Fallback: simpler URL+title extraction if block regex missed
    if (results.length === 0) {
        const linkRe = /href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"?#]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
        let m;
        while ((m = linkRe.exec(html)) !== null && results.length < 10) {
            const url = m[1].replace(/\/$/, '');
            const rawTitle = m[2].replace(/<[^>]+>/g, '').trim();
            const dashM = /^(.+?)\s*[-–]\s*(.+?)\s*(?:\|.*)?$/.exec(rawTitle);
            const name  = dashM ? dashM[1].trim() : rawTitle.replace(/\s*\|.*$/, '').trim();
            const title = dashM ? dashM[2].replace(/\s*\|.*$/, '').trim() : '';
            if (name) results.push({ name, title, url, snippet: '' });
        }
    }

    return results;
}

/**
 * Search LinkedIn profiles by job title + optional location
 * @param {string} jobTitle  e.g. "marketing director"
 * @param {string} location  e.g. "Romania"
 * @param {string} apiKey
 * @returns {Promise<Array<{ name: string; title: string; url: string; snippet: string }>>}
 */
async function searchLinkedInProfiles(jobTitle, location, apiKey) {
    const query = location
        ? `site:linkedin.com/in "${jobTitle}" "${location}"`
        : `site:linkedin.com/in "${jobTitle}"`;

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`;
    const html = await fetchSerp(googleUrl, apiKey);
    console.log('[LinkedInSearch] HTML length:', html.length, 'preview:', String(html).slice(0, 500));
    return parseResults(html);
}

module.exports = { searchLinkedInProfiles };
