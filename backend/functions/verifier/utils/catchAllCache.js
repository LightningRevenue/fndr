const winston = require('winston');
const { loggerTypes } = require('../../logging/logger');
const sqlAsync = require('../../../database/sqlAsync');
const promiseAwait = require('../../utils/promiseAwait');
const promiseAwaitMs = require('../../utils/promiseAwaitMs');

/**
 * Enhanced cache entry with confidence scoring
 * @typedef {Object} CacheEntry
 * @property {boolean} catch_all
 * @property {number} confidence - 0-100 confidence score
 * @property {number} test_count - Number of tests performed
 * @property {number} expires_at
 * @property {number} created_at
 */

/**
 * This function caches catch-all queries for the SMTP verification stage
 * Enhanced with confidence scoring and validation
 */
class CatchAllCache {
	/** database table name @private @type {string} */
	table_name = 'catch_all_cache';
	/** catch-all cache for duration @private @type {number} */
	duration = 24 * 60 * 60 * 1000; // 1 day
	/** auto clean interval @private @type {number} */
	auto_clean_interval = 15 * 60 * 1000; // 15 mins
	/** is ready @private @type {boolean} */
	ready = false;
	/** Logger @private */
	logger = winston.loggers.get(loggerTypes.smtp);
	/** Minimum confidence threshold for using cached results @private @type {number} */
	minConfidenceThreshold = 70;

	constructor() {
		this.init();
	}

	/** cache catch-all data for domain with enhanced confidence tracking
	 * @param {string} domain
	 * @param {boolean} is_catch_all - true if catch-all else false
	 * @param {number} confidence - confidence score 0-100 (default: 90)
	 * @param {number} test_count - number of tests performed (default: 1)
	 */
	async cache(domain, is_catch_all, confidence = 90, test_count = 1) {
		let success = false;
		await this.waitForReady();
		try {
			// get the values required
			const catch_all = is_catch_all ? 1 : 0,
				expires_at = new Date().getTime() + this.duration,
				created_at = new Date().getTime();

			// Enhanced cache entry with confidence and test count
			await sqlAsync.runAsync(
				`INSERT INTO ${this.table_name} (domain, catch_all, confidence, test_count, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (domain) DO UPDATE SET 
                    catch_all = excluded.catch_all, 
                    confidence = CASE 
                        WHEN excluded.confidence > ${this.table_name}.confidence THEN excluded.confidence
                        ELSE (${this.table_name}.confidence + excluded.confidence) / 2
                    END,
                    test_count = ${this.table_name}.test_count + excluded.test_count,
                    expires_at = excluded.expires_at`,
				[domain, catch_all, confidence, test_count, expires_at, created_at]
			);

			this.logger.debug(`Cached catch-all for ${domain}: ${is_catch_all} (confidence: ${confidence}%, tests: ${test_count})`);
			success = true;
		} catch (error) {
			this.logger.error(`CatchAllCache cache() error -> ${error?.toString()}`);
		} finally {
			return success;
		}
	}

	/** Enhanced fetch data from cache with validation
	 * @param {string} domain
	 * @returns {Promise<boolean | null>} - null if not cached or confidence too low, boolean if reliable cache hit
	 */
	async check(domain) {
		let catch_all = null;
		await this.waitForReady();
		try {
			// get the data from the database
			const sqlRes = await sqlAsync.getAsync(`SELECT * FROM ${this.table_name} WHERE domain = ?`, [domain]);

			if (sqlRes) {
				/** @type {any} */
				const obj = sqlRes;
				
				// Validate cache entry before using it
				if (!this.isCacheValid(obj)) {
					this.logger.debug(`Cache entry for ${domain} is invalid or expired, skipping cache`);
					return null;
				}
				
				// Check confidence threshold
				const confidence = parseInt(obj?.confidence || 0, 10);
				if (confidence < this.minConfidenceThreshold) {
					this.logger.debug(`Cache entry for ${domain} has low confidence (${confidence}%), requiring fresh verification`);
					return null;
				}
				
				if (obj?.catch_all == '1') catch_all = true;
				else if (obj?.catch_all == '0') catch_all = false;
				
				this.logger.debug(`Cache hit for ${domain}: ${catch_all} (confidence: ${confidence}%, tests: ${obj?.test_count || 1})`);
			}
		} catch (error) {
			this.logger.error(`CatchAllCache check() error -> ${error?.toString()}`);
		} finally {
			return catch_all;
		}
	}

	/** automatically remove expired catch-all data */
	async auto_clean() {
		await this.waitForReady();
		try {
			// clean the entries in the database
			await sqlAsync.runAsync(`DELETE FROM ${this.table_name} WHERE expires_at <= ?`, [new Date().getTime()]);
		} catch (error) {
			this.logger.error(`CatchAllCache auto_clean() error -> `, error);
		} finally {
			await promiseAwaitMs(this.auto_clean_interval);

			// start the auto clean function again
			this.auto_clean();
		}
	}

	/** clean all cache */
	async clean() {
		await this.waitForReady();
		try {
			await sqlAsync.runAsync(`DELETE FROM ${this.table_name}`);
		} catch (error) {
			this.logger.error(`CatchAllCache clean() error -> ${error?.toString()}`);
		}
	}

	/** Initialize the cache
	 * @private
	 */
	async init() {
		try {
			// create the enhanced table in the database if it doesn't exist yet
			await sqlAsync.runAsync(`CREATE TABLE IF NOT EXISTS ${this.table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL UNIQUE,
                catch_all INTEGER NOT NULL,
                confidence INTEGER DEFAULT 90,
                test_count INTEGER DEFAULT 1,
                expires_at INTEGER,
                created_at INTEGER
            )`);

			// Migrate existing entries to new schema if needed
			try {
				await sqlAsync.runAsync(`ALTER TABLE ${this.table_name} ADD COLUMN confidence INTEGER DEFAULT 90`);
				await sqlAsync.runAsync(`ALTER TABLE ${this.table_name} ADD COLUMN test_count INTEGER DEFAULT 1`);
				await sqlAsync.runAsync(`ALTER TABLE ${this.table_name} ADD COLUMN created_at INTEGER`);
			} catch (error) {
				// Columns already exist, this is expected
			}

			// mark as ready
			this.ready = true;
		} catch (error) {
			this.logger.error(`CatchAllCache init() error -> ${error?.toString()}`);
		}
	}

	/**
	 * Validate cache entry for freshness and integrity
	 * @private
	 * @param {any} cacheEntry
	 * @returns {boolean}
	 */
	isCacheValid(cacheEntry) {
		if (!cacheEntry) return false;
		
		const now = new Date().getTime();
		const expiresAt = parseInt(cacheEntry.expires_at || 0, 10);
		
		// Check if cache entry has expired
		if (expiresAt > 0 && now > expiresAt) {
			return false;
		}
		
		// Check if cache entry has required fields
		if (cacheEntry.catch_all === undefined || cacheEntry.catch_all === null) {
			return false;
		}
		
		// Check minimum age to avoid very fresh entries that might be unstable
		const createdAt = parseInt(cacheEntry.created_at || 0, 10);
		const minAge = 5 * 60 * 1000; // 5 minutes minimum age
		if (createdAt > 0 && (now - createdAt) < minAge) {
			this.logger.debug(`Cache entry too fresh (${Math.round((now - createdAt) / 1000)}s old), requiring verification`);
			return false;
		}
		
		return true;
	}

	/** @private - wait for the queue to get ready */
	async waitForReady() {
		while (true) {
			if (this.ready) return this.ready;

			// wait for .5 seconds
			await promiseAwait(0.5);
		}
	}

	/**
	 * Returns confidence tier string based on test_count and confidence score
	 * @param {string} domain
	 * @returns {Promise<'unverified'|'low'|'medium'|'high'>}
	 */
	async getCatchAllConfidenceLevel(domain) {
		/** @type {'unverified'|'low'|'medium'|'high'} */
		let tier = 'unverified';
		await this.waitForReady();
		try {
			const sqlRes = await sqlAsync.getAsync(`SELECT * FROM ${this.table_name} WHERE domain = ?`, [domain]);

			if (!sqlRes) return 'unverified';

			/** @type {any} */
			const obj = sqlRes;
			const testCount = parseInt(obj?.test_count || 0, 10);
			const confidence = parseInt(obj?.confidence || 0, 10);

			if (testCount >= 3 && confidence >= 80) tier = 'high';
			else if (testCount >= 2 && confidence >= 65) tier = 'medium';
			else tier = 'low';
		} catch (error) {
			this.logger.error(`CatchAllCache getCatchAllConfidenceLevel() error -> ${error?.toString()}`);
		} finally {
			return tier;
		}
	}
}

const catchAllCache = new CatchAllCache();

module.exports = catchAllCache;
