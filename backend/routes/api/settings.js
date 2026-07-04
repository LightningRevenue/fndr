'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { isAuthenticated } = require('../../functions/middleware/authenticate');

const router = express.Router();
router.use(isAuthenticated);

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

/**
 * Read a key from the .env file
 * @param {string} key
 * @returns {string}
 */
function readEnvKey(key) {
    try {
        const content = fs.readFileSync(ENV_PATH, 'utf8');
        const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
        return match ? match[1].trim() : '';
    } catch (_) {
        return '';
    }
}

/**
 * Write or update a key in the .env file
 * @param {string} key
 * @param {string} value
 */
function writeEnvKey(key, value) {
    try {
        let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
        const re = new RegExp(`^${key}=.*$`, 'm');
        if (re.test(content)) {
            content = content.replace(re, `${key}=${value}`);
        } else {
            content += `\n${key}=${value}\n`;
        }
        fs.writeFileSync(ENV_PATH, content, 'utf8');
        process.env[key] = value;
    } catch (err) {
        throw new Error(`Failed to write ${key} to .env: ${err instanceof Error ? err.message : String(err)}`);
    }
}


/**
 * GET /api/settings/brightdata-api-key
 */
router.get('/brightdata-api-key',
    /** @type {import('express').RequestHandler} */
    (req, res) => {
        try {
            const key = process.env.BRIGHTDATA_API_KEY || readEnvKey('BRIGHTDATA_API_KEY');
            const masked = key ? `${key.slice(0, 6)}${'*'.repeat(Math.max(0, key.length - 10))}${key.slice(-4)}` : '';
            res.json({ success: true, data: { isSet: !!key, masked } });
        } catch (err) {
            res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Failed to read key' });
        } finally {
            console.debug('GET /api/settings/brightdata-api-key completed');
        }
    }
);

/**
 * PATCH /api/settings/brightdata-api-key
 * Body: { key: string }
 */
router.patch('/brightdata-api-key',
    /** @type {import('express').RequestHandler} */
    (req, res) => {
        try {
            const { key } = /** @type {{ key: string }} */ (req.body);
            if (!key || typeof key !== 'string' || !key.trim()) {
                res.status(400).json({ success: false, message: 'key is required' });
                return;
            }
            writeEnvKey('BRIGHTDATA_API_KEY', key.trim());
            res.json({ success: true, message: 'Bright Data key updated' });
        } catch (err) {
            res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Failed to update key' });
        } finally {
            console.debug('PATCH /api/settings/brightdata-api-key completed');
        }
    }
);

/**
 * GET /api/settings/brightdata-serp-key
 */
router.get('/brightdata-serp-key',
    /** @type {import('express').RequestHandler} */
    (req, res) => {
        try {
            const key = process.env.BRIGHTDATA_SERP_KEY || readEnvKey('BRIGHTDATA_SERP_KEY');
            const masked = key ? `${key.slice(0, 6)}${'*'.repeat(Math.max(0, key.length - 10))}${key.slice(-4)}` : '';
            res.json({ success: true, data: { isSet: !!key, masked } });
        } catch (err) {
            res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Failed to read key' });
        } finally {
            console.debug('GET /api/settings/brightdata-serp-key completed');
        }
    }
);

/**
 * PATCH /api/settings/brightdata-serp-key
 * Body: { key: string }
 */
router.patch('/brightdata-serp-key',
    /** @type {import('express').RequestHandler} */
    (req, res) => {
        try {
            const { key } = /** @type {{ key: string }} */ (req.body);
            if (!key || typeof key !== 'string' || !key.trim()) {
                res.status(400).json({ success: false, message: 'key is required' });
                return;
            }
            writeEnvKey('BRIGHTDATA_SERP_KEY', key.trim());
            res.json({ success: true, message: 'Bright Data SERP key updated' });
        } catch (err) {
            res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Failed to update key' });
        } finally {
            console.debug('PATCH /api/settings/brightdata-serp-key completed');
        }
    }
);

module.exports = router;
