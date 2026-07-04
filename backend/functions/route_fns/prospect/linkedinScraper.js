'use strict';

const axios = require('axios');
const { extractDomain } = require('./serpScraper');

const BD_BASE = 'https://api.brightdata.com/datasets/v3/scrape';
const BD_PROFILE_DATASET = 'gd_l1viktl72bvl7bjuj0';
const BD_COMPANY_DATASET = 'gd_l1vikfnt1wgvvqz95w';

/**
 * Trigger a Bright Data scrape and wait for results (synchronous mode)
 * Bright Data returns results directly when notify=false
 * @param {string} datasetId
 * @param {Array<Record<string, string>>} input
 * @param {string} apiKey
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function bdScrape(datasetId, input, apiKey) {
    const res = await axios.post(
        `${BD_BASE}?dataset_id=${datasetId}&notify=false&include_errors=true`,
        { input, limit_per_input: null },
        {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        }
    );

    // Bright Data returns array directly or { snapshot_id } for async
    if (Array.isArray(res.data)) return res.data;

    // If async snapshot, poll for results
    const snapshotId = res.data?.snapshot_id;
    if (snapshotId) return pollSnapshot(snapshotId, apiKey);

    return [];
}

/**
 * Poll Bright Data snapshot until ready
 * @param {string} snapshotId
 * @param {string} apiKey
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function pollSnapshot(snapshotId, apiKey) {
    const url = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`;
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await axios.get(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
        });
        if (Array.isArray(res.data) && res.data.length > 0) return res.data;
        if (res.data?.status === 'failed') throw new Error('Bright Data snapshot failed');
    }
    throw new Error('Bright Data snapshot timed out');
}

/**
 * Main: scrape LinkedIn profile → name, role, domain
 * @param {string} profileUrl
 * @param {string} apiKey
 * @returns {Promise<{ firstName: string; lastName: string; role: string; companyLinkedinUrl: string; domain: string }>}
 */
async function scrapeLinkedInProfile(profileUrl, apiKey) {
    // Step 1: fetch profile
    const profiles = await bdScrape(BD_PROFILE_DATASET, [{ url: profileUrl }], apiKey);
    const profile = profiles[0] ?? {};

    const firstName = String(profile.first_name ?? profile.firstName ?? '');
    const lastName  = String(profile.last_name  ?? profile.lastName  ?? '');
    const role      = String(profile.headline   ?? profile.title     ?? profile.position ?? '');

    // Current company URL from experiences
    const experiences = /** @type {Array<Record<string, unknown>>} */ (
        profile.experience ?? profile.experiences ?? []
    );
    const current = experiences.find((e) => !e.end_date && !e.ends_at && !e.to);
    const companyLinkedinUrl = String(
        current?.company_linkedin_url ??
        current?.company_url ??
        current?.linkedin_url ??
        ''
    );

    let domain = '';

    // Step 2: fetch company if we have a URL
    if (companyLinkedinUrl && companyLinkedinUrl.includes('linkedin.com/company')) {
        try {
            const companies = await bdScrape(BD_COMPANY_DATASET, [{ url: companyLinkedinUrl }], apiKey);
            const company = companies[0] ?? {};
            const website = String(company.website ?? company.company_url ?? '');
            if (website && !website.includes('linkedin.com')) {
                domain = extractDomain(website);
            }
        } catch (err) {
            console.error('[BrightData] company fetch failed:', err instanceof Error ? err.message : String(err));
        }
    }

    return { firstName, lastName, role, companyLinkedinUrl, domain };
}

module.exports = { scrapeLinkedInProfile };
