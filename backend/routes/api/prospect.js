/**
 * Prospect API routes
 * Google Maps place search + SERP owner discovery
 */

'use strict';

const express = require('express');
const { isAuthenticated } = require('../../functions/middleware/authenticate');
const { searchPlaces, getPlaceDetails } = require('../../functions/route_fns/prospect/googleMaps');
const { findOwner, extractDomain } = require('../../functions/route_fns/prospect/serpScraper');
const { scrapeLinkedInProfile } = require('../../functions/route_fns/prospect/linkedinScraper');
const { searchLinkedInProfiles } = require('../../functions/route_fns/prospect/linkedinSearch');

const router = express.Router();


// All prospect routes require authentication
router.use(isAuthenticated);


/**
 * POST /api/prospect/maps-search
 * Search companies via Google Maps Text Search
 * Body: { query: string, location: string, apiKey: string }
 */
router.post('/maps-search',

    /** @type {import('express').RequestHandler} */
    async (req, res) => {
        try {
            const { query, location, apiKey } = /** @type {{ query: string; location: string; apiKey: string }} */ (req.body);

            if (!query || !location || !apiKey) {
                res.status(400).json({ success: false, message: 'query, location, and apiKey are required' });
                return;
            }

            const fullQuery = `${query} ${location}`;
            const places = await searchPlaces(fullQuery, apiKey);

            // Limit to 20 to avoid slow responses; fetch details in parallel
            const slice = places.slice(0, 20);

            const detailsArr = await Promise.all(
                slice.map((place) => getPlaceDetails(place.place_id, apiKey))
            );

            const companies = slice.map((place, i) => {
                const details = detailsArr[i];
                return {
                    place_id: place.place_id,
                    name: place.name,
                    address: place.address,
                    rating: place.rating,
                    website: details.website,
                    phone: details.phone,
                    domain: details.website ? extractDomain(details.website) : '',
                };
            });

            res.json({ success: true, data: { companies } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Maps search failed';
            console.error('POST /api/prospect/maps-search error:', message);
            res.status(500).json({ success: false, message });
        } finally {
            console.debug('POST /api/prospect/maps-search completed');
        }
    }
);


/**
 * POST /api/prospect/find-owner
 * Find company owner via SERP scraping
 * Body: { companyName: string, domain: string }
 */
router.post('/find-owner',

    /** @type {import('express').RequestHandler} */
    async (req, res) => {
        try {
            const { companyName, domain } = /** @type {{ companyName: string; domain: string }} */ (req.body);

            if (!companyName) {
                res.status(400).json({ success: false, message: 'companyName is required' });
                return;
            }

            const owner = await findOwner(companyName, domain || '');

            res.json({ success: true, data: { owner } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Owner lookup failed';
            console.error('POST /api/prospect/find-owner error:', message);
            res.status(500).json({ success: false, message });
        } finally {
            console.debug('POST /api/prospect/find-owner completed');
        }
    }
);


/**
 * POST /api/prospect/company-search
 * Single company lookup — find domain + owner via SERP
 * Body: { companyName: string }
 */
router.post('/company-search',

    /** @type {import('express').RequestHandler} */
    async (req, res) => {
        try {
            const { companyName } = /** @type {{ companyName: string }} */ (req.body);

            if (!companyName) {
                res.status(400).json({ success: false, message: 'companyName is required' });
                return;
            }

            // Discover domain via SERP — find first non-reference-site URL
            let domain = '';
            try {
                const { buildSearchQueries } = require('../../functions/route_fns/prospect/serpScraper');
                const https = require('https');

                const domainQuery = `"${companyName}" site Romania contact`;
                const encoded = encodeURIComponent(domainQuery);
                const url = `https://www.google.com/search?q=${encoded}&hl=ro&num=10`;

                const html = await new Promise((resolve, reject) => {
                    const options = {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                            'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        },
                    };
                    https.get(url, options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', () => resolve(data));
                    }).on('error', reject);
                });

                // Extract first non-noise URL
                const SKIP_DOMAINS = /google\.|linkedin\.|termene\.|listafirme\.|facebook\.|wikipedia\./i;
                const urlRe = /<a href="\/url\?q=([^&"]+)/g;
                let m;
                while ((m = urlRe.exec(/** @type {string} */ (html))) !== null) {
                    try {
                        const raw = decodeURIComponent(m[1]);
                        if (!SKIP_DOMAINS.test(raw)) {
                            domain = extractDomain(raw);
                            break;
                        }
                    } catch (_) { /* skip */ }
                }
            } catch (domainErr) {
                console.error('company-search domain discovery error:', domainErr instanceof Error ? domainErr.message : String(domainErr));
            }

            const owner = await findOwner(companyName, domain);

            res.json({
                success: true,
                data: { name: companyName, domain, owner },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Company search failed';
            console.error('POST /api/prospect/company-search error:', message);
            res.status(500).json({ success: false, message });
        } finally {
            console.debug('POST /api/prospect/company-search completed');
        }
    }
);


/**
 * POST /api/prospect/linkedin-profile
 * Scrape a LinkedIn profile via ScraperAPI → name, role, domain
 * Body: { profileUrl: string }
 */
router.post('/linkedin-profile',

    /** @type {import('express').RequestHandler} */
    async (req, res) => {
        try {
            const { profileUrl } = /** @type {{ profileUrl: string }} */ (req.body);

            if (!profileUrl || !profileUrl.includes('linkedin.com/in/')) {
                res.status(400).json({ success: false, message: 'Valid LinkedIn profile URL is required' });
                return;
            }

            const apiKey = process.env.BRIGHTDATA_API_KEY || '';
            if (!apiKey) {
                res.status(500).json({ success: false, message: 'Bright Data API key not configured. Set it in API Keys → Integrations.' });
                return;
            }

            const data = await scrapeLinkedInProfile(profileUrl, apiKey);
            res.json({ success: true, data });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'LinkedIn scrape failed';
            // Log full axios error response for debugging
            const axiosResp = /** @type {Record<string, unknown>} */ (err)?.response;
            if (axiosResp) console.error('POST /api/prospect/linkedin-profile axios response:', JSON.stringify(/** @type {Record<string, unknown>} */ (axiosResp)?.data ?? /** @type {Record<string, unknown>} */ (axiosResp)?.status));
            console.error('POST /api/prospect/linkedin-profile error:', message);
            res.status(500).json({ success: false, message });
        } finally {
            console.debug('POST /api/prospect/linkedin-profile completed');
        }
    }
);


/**
 * POST /api/prospect/linkedin-search
 * Search LinkedIn profiles by job title + location via Bright Data SERP
 * Body: { jobTitle: string, location?: string }
 */
router.post('/linkedin-search',

    /** @type {import('express').RequestHandler} */
    async (req, res) => {
        try {
            const { jobTitle, location } = /** @type {{ jobTitle: string; location?: string }} */ (req.body);

            if (!jobTitle?.trim()) {
                res.status(400).json({ success: false, message: 'jobTitle is required' });
                return;
            }

            const apiKey = process.env.BRIGHTDATA_SERP_KEY || '';
            if (!apiKey) {
                res.status(500).json({ success: false, message: 'Bright Data SERP key not configured. Set it in API Keys → Integrations.' });
                return;
            }

            const profiles = await searchLinkedInProfiles(jobTitle.trim(), location?.trim() ?? '', apiKey);
            console.log('[linkedin-search] profiles found:', profiles.length);
            res.json({ success: true, data: { profiles } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'LinkedIn search failed';
            const axiosResp = /** @type {Record<string, unknown>} */ (err)?.response;
            if (axiosResp) console.error('[linkedin-search] axios response:', JSON.stringify(/** @type {Record<string, unknown>} */ (axiosResp)?.data ?? /** @type {Record<string, unknown>} */ (axiosResp)?.status));
            console.error('POST /api/prospect/linkedin-search error:', message);
            res.status(500).json({ success: false, message });
        } finally {
            console.debug('POST /api/prospect/linkedin-search completed');
        }
    }
);

module.exports = router;
