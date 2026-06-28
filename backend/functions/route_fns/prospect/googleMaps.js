/**
 * Google Maps Places API integration
 * Uses Node.js built-in https — no external dependencies
 */

'use strict';

const https = require('https');


/**
 * @typedef {Object} PlaceResult
 * @property {string} place_id
 * @property {string} name
 * @property {string} address
 * @property {number|null} rating
 */

/**
 * @typedef {Object} PlaceDetails
 * @property {string} website
 * @property {string} phone
 * @property {string} name
 */


/**
 * Simple HTTPS GET helper — returns parsed JSON
 * @param {string} url
 * @returns {Promise<Record<string, unknown>>}
 */
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        try {
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(/** @type {Record<string, unknown>} */ (JSON.parse(data)));
                    } catch (parseErr) {
                        reject(parseErr);
                    }
                });
            }).on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}


/**
 * Sleep helper for pagination delays
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Search for places using Google Maps Text Search API
 * Handles pagination — up to 3 pages
 * @param {string} query - Search query (e.g. "restaurante București")
 * @param {string} apiKey - Google Maps API key
 * @returns {Promise<PlaceResult[]>}
 */
async function searchPlaces(query, apiKey) {
    /** @type {PlaceResult[]} */
    const results = [];

    try {
        const base = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
        const params = new URLSearchParams({ query, region: 'ro', language: 'ro', key: apiKey });
        let url = `${base}?${params.toString()}`;
        let pages = 0;

        while (url && pages < 3) {
            try {
                const data = await httpsGet(url);

                const rawResults = /** @type {Record<string, unknown>[]} */ (
                    Array.isArray(data.results) ? data.results : []
                );

                for (const place of rawResults) {
                    results.push({
                        place_id: typeof place.place_id === 'string' ? place.place_id : '',
                        name: typeof place.name === 'string' ? place.name : '',
                        address: typeof place.formatted_address === 'string' ? place.formatted_address : '',
                        rating: typeof place.rating === 'number' ? place.rating : null,
                    });
                }

                pages++;

                const token = typeof data.next_page_token === 'string' ? data.next_page_token : null;
                if (token && pages < 3) {
                    // Google requires a short delay before using next_page_token
                    await sleep(2000);
                    const nextParams = new URLSearchParams({ pagetoken: token, key: apiKey });
                    url = `${base}?${nextParams.toString()}`;
                } else {
                    url = '';
                }
            } catch (pageErr) {
                console.error('searchPlaces page error:', pageErr instanceof Error ? pageErr.message : String(pageErr));
                break;
            }
        }
    } catch (err) {
        console.error('searchPlaces error:', err instanceof Error ? err.message : String(err));
    } finally {
        console.debug(`searchPlaces returned ${results.length} results`);
    }

    return results;
}


/**
 * Get details for a single place
 * @param {string} placeId
 * @param {string} apiKey
 * @returns {Promise<PlaceDetails>}
 */
async function getPlaceDetails(placeId, apiKey) {
    /** @type {PlaceDetails} */
    const empty = { website: '', phone: '', name: '' };

    try {
        const params = new URLSearchParams({
            place_id: placeId,
            fields: 'name,website,formatted_phone_number',
            key: apiKey,
        });
        const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;

        const data = await httpsGet(url);
        const result = /** @type {Record<string, unknown>} */ (
            data.result && typeof data.result === 'object' ? data.result : {}
        );

        return {
            name: typeof result.name === 'string' ? result.name : '',
            website: typeof result.website === 'string' ? result.website : '',
            phone: typeof result.formatted_phone_number === 'string' ? result.formatted_phone_number : '',
        };
    } catch (err) {
        console.error('getPlaceDetails error:', err instanceof Error ? err.message : String(err));
        return empty;
    } finally {
        console.debug('getPlaceDetails completed for', placeId);
    }
}


module.exports = { searchPlaces, getPlaceDetails };
