/**
 * Prospect API routes
 * Google Maps place search + SERP owner discovery
 */

'use strict';

const express = require('express');
const { isAuthenticated } = require('../../functions/middleware/authenticate');
const { searchPlaces, getPlaceDetails } = require('../../functions/route_fns/prospect/googleMaps');
const { findOwner, extractDomain } = require('../../functions/route_fns/prospect/serpScraper');

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


module.exports = router;
