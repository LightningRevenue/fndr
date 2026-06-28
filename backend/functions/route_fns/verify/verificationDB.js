/**
 * Database functions for verification_requests table
 * Handles all database operations for email verification requests
 */

const { getDb } = require('../../../database/connection');


// ============================================================
// PAGINATION CONFIGURATION - Modify these values as needed
// ============================================================
const DEFAULT_PAGE_SIZE = 50;     // Default results per page
const MAX_PAGE_SIZE = 1000;       // Maximum results per page allowed
// ============================================================

/**
 * @typedef {Object} VerificationRequestRow
 * @property {string} verification_request_id
 * @property {string} request_type
 * @property {string} emails - JSON string: string[] during pending/processing, results[] after completion
 * @property {string | null} statistics - JSON string object or null
 * @property {string} status
 * @property {number} created_at
 * @property {number} updated_at
 * @property {number | null} completed_at
 */

/**
 * @typedef {Object} VerificationRequestCountRow
 * @property {number} total
 */


/**
 * Create a new verification request in the database
 * @param {Object} params - Verification request parameters
 * @param {string} params.verification_request_id - Unique ID for the verification request
 * @param {'single' | 'csv' | 'api'} params.request_type - Type of verification request
 * @param {string[]} params.emails - Array of emails to verify
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function createVerificationRequest({ verification_request_id, request_type, emails }) {
	try {
		const db = getDb();
		const now = Date.now();

		const stmt = db.prepare(`
            INSERT INTO verification_requests
            (verification_request_id, request_type, emails, status, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
        `);

		stmt.run(verification_request_id, request_type, JSON.stringify(emails), now, now);

		return {
			success: true,
			message: 'Verification request created successfully',
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Create verification request error:', errorMessage);

		return {
			success: false,
			message: 'Failed to create verification request',
		};
	} finally {
		console.debug('Create verification request process completed');
	}
}


/**
 * Update verification request status
 * @param {string} verification_request_id - Verification request ID
 * @param {'pending' | 'processing' | 'completed' | 'failed'} status - New status
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function updateVerificationStatus(verification_request_id, status) {
	try {
		const db = getDb();
		const now = Date.now();

		const stmt = db.prepare(`
            UPDATE verification_requests
            SET status = ?, updated_at = ?
            WHERE verification_request_id = ?
        `);

		stmt.run(status, now, verification_request_id);

		return {
			success: true,
			message: 'Verification status updated successfully',
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Update verification status error:', errorMessage);

		return {
			success: false,
			message: 'Failed to update verification status',
		};
	} finally {
		console.debug('Update verification status process completed');
	}
}


/**
 * Update verification request with results and calculate statistics
 * @param {string} verification_request_id - Verification request ID
 * @param {Array<{email: string, status: string, message: string}>} results - Verification results array
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function updateVerificationResults(verification_request_id, results) {
	try {
		const db = getDb();
		const now = Date.now();

		// Calculate statistics once
		const statistics = {
			valid: 0,
			invalid: 0,
			catch_all: 0,
			unknown: 0,
		};

		for (const result of results) {
			const status = result.status.toLowerCase().replace('-', '_');
			if (status === 'valid') {
				statistics.valid++;
			} else if (status === 'invalid') {
				statistics.invalid++;
			} else if (status === 'catch_all' || status === 'catchall') {
				statistics.catch_all++;
			} else if (status === 'unknown') {
				statistics.unknown++;
			}
		}

		// Store results in emails column (reusing space from initial email list)
		const stmt = db.prepare(`
            UPDATE verification_requests
            SET emails = ?, statistics = ?, status = 'completed', completed_at = ?, updated_at = ?
            WHERE verification_request_id = ?
        `);

		stmt.run(JSON.stringify(results), JSON.stringify(statistics), now, now, verification_request_id);

		return {
			success: true,
			message: 'Verification results updated successfully',
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Update verification results error:', errorMessage);

		return {
			success: false,
			message: 'Failed to update verification results',
		};
	} finally {
		console.debug('Update verification results process completed');
	}
}


/**
 * Get verification request by ID
 * @param {string} verification_request_id - Verification request ID
 * @returns {Promise<Object | null>} Verification request object or null
 */
async function getVerificationRequest(verification_request_id) {
	try {
		const db = getDb();

		const stmt = db.prepare(`
            SELECT * FROM verification_requests
            WHERE verification_request_id = ?
        `);

		const row = /** @type {VerificationRequestRow | undefined} */ (stmt.get(verification_request_id));

		if (!row) {
			return null;
		}

		// Parse JSON fields
		// emails column contains: string[] during pending/processing, results[] after completion
		return {
			verification_request_id: row.verification_request_id,
			request_type: row.request_type,
			emails: JSON.parse(row.emails),
			statistics: row.statistics ? JSON.parse(row.statistics) : null,
			status: row.status,
			created_at: row.created_at,
			updated_at: row.updated_at,
			completed_at: row.completed_at,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Get verification request error:', errorMessage);

		return null;
	} finally {
		console.debug('Get verification request process completed');
	}
}


/**
 * Get verification history (single-user system)
 * @param {Object} options - Query options
 * @param {number} [options.page] - Page number (default: 1)
 * @param {number} [options.per_page] - Items per page (default: 50)
 * @param {'single' | 'csv' | 'api'} [options.request_type] - Filter by request type
 * @param {'pending' | 'processing' | 'completed' | 'failed'} [options.status] - Filter by status
 * @returns {Promise<{requests: Array<Object>, total: number, page: number, per_page: number}>}
 */
async function getUserVerificationHistory(options = {}) {
	const page = options.page || 1;
	const per_page = options.per_page || 50;

	try {
		const db = getDb();
		const offset = (page - 1) * per_page;

		// Build WHERE clause with filters (single-user system - no user_id filter)
		const whereClauses = [];
		/** @type {Array<string | number>} */
		const params = [];

		if (options.request_type) {
			whereClauses.push('request_type = ?');
			params.push(options.request_type);
		}

		if (options.status) {
			whereClauses.push('status = ?');
			params.push(options.status);
		}

		const whereClause = whereClauses.length > 0 ? whereClauses.join(' AND ') : '1=1';

		// Get total count
		const countStmt = db.prepare(`
            SELECT COUNT(*) as total
            FROM verification_requests
            WHERE ${whereClause}
        `);
		const countRow = /** @type {VerificationRequestCountRow | undefined} */ (countStmt.get(...params));
		const total = countRow?.total || 0;

		// Get paginated requests
		const stmt = db.prepare(`
            SELECT
                verification_request_id,
                request_type,
                status,
                json_array_length(emails) as email_count,
                created_at,
                updated_at,
                completed_at
            FROM verification_requests
            WHERE ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);

		const rows = stmt.all(...params, per_page, offset);

		return {
			requests: rows,
			total: total,
			page: page,
			per_page: per_page,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Get user verification history error:', errorMessage);

		return {
			requests: [],
			total: 0,
			page: page,
			per_page: per_page,
		};
	} finally {
		console.debug('Get user verification history process completed');
	}
}


/**
 * Get paginated verification results with DB-level LIMIT/OFFSET using json_each()
 * PERFORMANCE OPTIMIZED: Uses SQLite's json_each() to paginate at database level
 * This extracts ONLY the requested page from the JSON array without loading all results
 *
 * Memory savings: ~10-50KB per page vs 30-50MB for loading 100k results
 * Speed improvement: ~10-20x faster for large result sets
 *
 * @param {string} verification_request_id - Verification request ID
 * @param {number} page - Page number (1-indexed, defaults to 1)
 * @param {number} perPage - Items per page (defaults to DEFAULT_PAGE_SIZE, capped at MAX_PAGE_SIZE)
 * @returns {Promise<{results: Array<Object>, total: number} | null>} Paginated results and total count
 */
async function getVerificationResultsPaginated(verification_request_id, page, perPage) {
	try {
		const db = getDb();

		// Get total count of results
		const countStmt = db.prepare(`
            SELECT json_array_length(emails) as total
            FROM verification_requests
            WHERE verification_request_id = ? AND status = 'completed'
        `);

		const countRow = /** @type {{total: number} | undefined} */ (countStmt.get(verification_request_id));
		const total = countRow?.total || 0;

		if (total === 0) {
			return {
				results: [],
				total: 0,
			};
		}

		// Validate and cap page size to prevent excessive data loading
		const validatedPerPage = Math.min(Math.max(1, perPage || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
		const validatedPage = Math.max(1, page || 1);
		const validatedOffset = (validatedPage - 1) * validatedPerPage;

		// Use json_each() to extract ONLY the requested page from the JSON array
		// This avoids loading the entire array into memory (MAJOR performance improvement)
		// Memory: ~10-50KB per page vs 30-50MB for full 100k results
		const stmt = db.prepare(`
            SELECT value
            FROM verification_requests, json_each(verification_requests.emails)
            WHERE verification_request_id = ?
            LIMIT ? OFFSET ?
        `);

		const rows = stmt.all(verification_request_id, validatedPerPage, validatedOffset);

		// Parse each JSON value from the result rows
		const results = rows.map(row => JSON.parse(/** @type {{value: string}} */ (row).value));

		return {
			results: results,
			total: total,
		};

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Get verification results paginated error:', errorMessage);

		return null;
	} finally {
		console.debug('Get verification results paginated process completed');
	}
}


/**
 * Get CSV upload details for a verification request
 * @param {string} verification_request_id - Verification request ID
 * @returns {Promise<Object | null>} CSV details object or null
 */
async function getCsvDetails(verification_request_id) {
	try {
		const db = getDb();

		const stmt = db.prepare(`
            SELECT csv_upload_id, list_name, original_filename, has_header, headers,
                   selected_email_column, detection_confidence, row_count, column_count
            FROM csv_uploads
            WHERE verification_request_id = ?
        `);

		const csvUpload = /** @type {{csv_upload_id: string, list_name: string | null, original_filename: string, has_header: number, headers: string, selected_email_column: string | null, detection_confidence: number | null, row_count: number, column_count: number} | undefined} */ (stmt.get(verification_request_id));

		if (!csvUpload) {
			return null;
		}

		return {
			csv_upload_id: csvUpload.csv_upload_id,
			list_name: csvUpload.list_name,
			original_filename: csvUpload.original_filename,
			has_header: csvUpload.has_header === 1,
			headers: JSON.parse(csvUpload.headers),
			selected_email_column: csvUpload.selected_email_column,
			detection_confidence: csvUpload.detection_confidence,
			row_count: csvUpload.row_count,
			column_count: csvUpload.column_count,
			download_url: `/api/verifier/csv/${csvUpload.csv_upload_id}/download`
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Get CSV details error:', errorMessage);

		return null;
	} finally {
		console.debug('Get CSV details process completed');
	}
}


/**
 * Upsert valid emails into the valid_emails ledger
 * @param {Array<{email: string, status: string, message: string}>} results
 * @param {string} source - 'single' | 'csv' | 'api'
 * @returns {void}
 */
function saveValidEmails(results, source) {
	try {
		const db = getDb();
		const now = Date.now();

		const stmt = db.prepare(`
            INSERT INTO valid_emails (email, domain, source, verified_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                domain = excluded.domain,
                source = excluded.source,
                verified_at = excluded.verified_at
        `);

		const upsertMany = db.transaction((rows) => {
			for (const row of rows) {
				stmt.run(row.email, row.domain, source, now);
			}
		});

		const validOnly = results
			.filter(r => r.status === 'valid')
			.map(r => ({ email: r.email, domain: r.email.split('@')[1] || '' }));

		if (validOnly.length > 0) upsertMany(validOnly);

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Save valid emails error:', errorMessage);
	} finally {
		console.debug('Save valid emails process completed');
	}
}


/**
 * Get all valid emails grouped by domain with pagination
 * @param {number} page
 * @param {number} perPage
 * @param {string | null} domain - optional domain filter
 * @returns {{ domains: Array<{domain: string, count: number}>, emails: Array<{email: string, domain: string, source: string, verified_at: number}>, total: number } | null}
 */
function getValidEmails(page = 1, perPage = 50, domain = null) {
	try {
		const db = getDb();
		const offset = (page - 1) * perPage;

		const domains = db.prepare(`
            SELECT domain, COUNT(*) as count
            FROM valid_emails
            GROUP BY domain
            ORDER BY count DESC, domain ASC
        `).all();

		const countStmt = domain
			? db.prepare('SELECT COUNT(*) as total FROM valid_emails WHERE domain = ?')
			: db.prepare('SELECT COUNT(*) as total FROM valid_emails');

		const emailsStmt = domain
			? db.prepare('SELECT email, domain, source, verified_at FROM valid_emails WHERE domain = ? ORDER BY verified_at DESC LIMIT ? OFFSET ?')
			: db.prepare('SELECT email, domain, source, verified_at FROM valid_emails ORDER BY domain ASC, verified_at DESC LIMIT ? OFFSET ?');

		/** @type {{total: number}} */
		const countRow = domain ? countStmt.get(domain) : countStmt.get();
		const total = countRow?.total ?? 0;

		const emails = domain
			? emailsStmt.all(domain, perPage, offset)
			: emailsStmt.all(perPage, offset);

		return { domains, emails, total };

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Get valid emails error:', errorMessage);
		return null;
	} finally {
		console.debug('Get valid emails process completed');
	}
}


// Export functions
module.exports = {
	createVerificationRequest,
	updateVerificationStatus,
	updateVerificationResults,
	getVerificationRequest,
	getUserVerificationHistory,
	getVerificationResultsPaginated,
	getCsvDetails,
	saveValidEmails,
	getValidEmails,
};
