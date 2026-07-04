/**
 * Bulk CSV email verification route functions
 * Handles CSV-specific operations: upload (with automatic email detection) and submission
 *
 * For status checking, see verificationStatus.js
 * For results retrieval, see verificationResults.js
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const multer = require('multer');
const queue = require('../../staging/queue');
const { getDb } = require('../../../database/connection');
const { MAX_CSV_ROWS, MAX_CSV_SIZE_MB } = require('../../../data/env');
const { createVerificationRequest, updateVerificationStatus } = require('./verificationDB');
const isValidEmail = require('../../utils/isValidEmail');


// ============================================================
// CSV PARSING SAFETY - Header sanitization & validation
// ============================================================

/**
 * NOTE ON PAPAPARSE SAFETY:
 * - Commas (,) in cell values: ✅ Handled automatically by PapaParse (RFC 4180)
 * - Newlines (\n) in cell values: ✅ Handled automatically when quoted
 * - Quotes ("): ✅ Properly escaped as "" by PapaParse
 *
 * REMAINING ISSUES WE MUST HANDLE:
 * - Dots (.) in headers: ❌ Break JavaScript object access
 * - Special characters in headers: ❌ Break JSON/object keys
 * - Malformed CSV structure: ❌ Need validation
 */

/**
 * Sanitize CSV header names to prevent JavaScript object key issues
 *
 * Issues this prevents:
 * 1. Dots (.) create nested object access: header["user.email"] fails
 * 2. Brackets ([]) interfere with array access
 * 3. Special chars break JSON.stringify/parse
 * 4. Leading numbers make invalid JS identifiers
 *
 * Examples:
 * - "user.email" → "user_email"
 * - "data[0]" → "data_0_"
 * - "123column" → "col_123column"
 * - "First Name!" → "First_Name"
 *
 * @param {string} header - Original header name from CSV
 * @returns {string} Sanitized header name safe for object keys
 */
function sanitizeHeader(header) {
	if (!header || typeof header !== 'string') {
		return 'unnamed_column';
	}

	let sanitized = header
		.trim()
		// Replace dots with underscores
		.replace(/\./g, '_')
		// Replace brackets with underscores (keep trailing underscore for clarity)
		.replace(/\[/g, '_')
		.replace(/\]/g, '_')
		// Replace other problematic chars with underscores
		.replace(/[^\w\s-]/g, '_')
		// Replace whitespace with underscores
		.replace(/\s+/g, '_')
		// Remove consecutive underscores
		.replace(/_+/g, '_')
		// Remove leading underscores only (keep trailing for bracket clarity)
		.replace(/^_+/g, '');

	// Ensure doesn't start with a number
	if (/^\d/.test(sanitized)) {
		sanitized = 'col_' + sanitized;
	}

	// Fallback if empty after sanitization
	if (!sanitized) {
		return 'unnamed_column';
	}

	return sanitized;
}


/**
 * Validate PapaParse results for errors
 *
 * @param {Object} results - PapaParse results object
 * @param {number} rowIndex - Current row index for error reporting
 * @throws {Error} If parsing errors are detected
 */
function validateParseResults(results, rowIndex) {
	if (results.errors && results.errors.length > 0) {
		// Filter out non-fatal warnings (e.g., UndetectableDelimiter for single-column CSVs)
		const fatalErrors = results.errors.filter(error =>
			error.code !== 'UndetectableDelimiter'
		);

		if (fatalErrors.length > 0) {
			const error = fatalErrors[0];
			throw new Error(`CSV parsing error at row ${rowIndex}: ${error.message || 'Unknown error'}`);
		}
	}

	if (results.meta && results.meta.aborted) {
		throw new Error(`CSV parsing was aborted at row ${rowIndex}`);
	}
}

// ============================================================


/**
 * @typedef {Object} CsvUploadRow
 * @property {string} csv_upload_id
 * @property {string | null} verification_request_id
 * @property {string | null} list_name
 * @property {string} original_filename
 * @property {string} file_path
 * @property {number} file_size
 * @property {number} has_header
 * @property {string} headers
 * @property {number} row_count
 * @property {number} column_count
 * @property {string} preview_data
 * @property {string | null} selected_email_column
 * @property {number | null} selected_email_column_index
 * @property {string | null} column_scores
 * @property {number | null} detection_confidence
 * @property {string} upload_status
 * @property {number} created_at
 * @property {number} updated_at
 * @property {string | null} results - From JOIN with verification_requests
 */

/**
 * @typedef {import('express').Request & {csvUploadId?: string, originalFilename?: string, file?: {path: string, size: number, originalname: string}}} MulterRequest
 */


// Configure Multer for disk storage
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		const uploadDir = path.join(__dirname, '../../../csv');
		if (!fs.existsSync(uploadDir)) {
			fs.mkdirSync(uploadDir, { recursive: true });
		}
		cb(null, uploadDir);
	},
	filename: (req, file, cb) => {
		const csvUploadId = `csv-${uuidv4()}`;
		req.csvUploadId = csvUploadId;
		req.originalFilename = file.originalname;
		cb(null, `${csvUploadId}_original.csv`);
	},
});

const upload = multer({
	storage: storage,
	limits: { fileSize: MAX_CSV_SIZE_MB * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		if (file.mimetype === 'text/csv' && file.originalname.endsWith('.csv')) {
			cb(null, true);
		} else {
			cb(new Error('Only CSV files allowed'), false);
		}
	},
});


/**
 * Upload and parse CSV file, then detect email column
 * Consolidated function that handles upload + email detection in one step
 *
 * @param {MulterRequest} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<import('express').Response | void>}
 */
async function uploadCSV(req, res) {
	try {
		const csvUploadId = req.csvUploadId;
		const filePath = req.file?.path;
		const originalFilename = req.originalFilename;

		// Get has_header and list_name from request body (now required)
		const hasHeader = req.body.has_header !== undefined
			? (req.body.has_header === true || req.body.has_header === 'true' || req.body.has_header === '1')
			: true;
		const listName = req.body.list_name || null;

		let rowIndex = 0;
		let totalRows = 0;
		let columnCount = 0;
		/** @type {string[]} */
		let headers = [];
		/** @type {Record<string, string>[]} */
		const preview = [];

		// Stream parse to get preview and count
		const stream = fs.createReadStream(filePath);

		await new Promise((resolve, reject) => {
			Papa.parse(stream, {
				header: false, // Manual parsing for full control
				skipEmptyLines: true, // Ignore empty rows
				step: (results) => {
					try {
						// Validate parse results for errors
						validateParseResults(results, rowIndex);

						const row = /** @type {string[]} */ (results.data);

						// Skip completely empty rows
						if (!row || row.length === 0 || row.every(cell => !cell || !cell.trim())) {
							return;
						}

						// First row handling
						if (rowIndex === 0) {
							columnCount = row.length;

							if (columnCount > 100) {
								reject(new Error('Too many columns (max 100)'));
								return;
							}

							if (hasHeader) {
								// First row is header - SANITIZE headers for safety
								headers = row.map(h => sanitizeHeader(h));
							} else {
								// No header - generate column names
								headers = row.map((_, i) => `Column_${i + 1}`);
								// First row is data - add to preview
								if (preview.length < 5) {
									/** @type {Record<string, string>} */
									const previewObj = {};
									headers.forEach((h, i) => (previewObj[h] = row[i] || ''));
									preview.push(previewObj);
								}
							}
						} else {
							// Data rows
							totalRows++;

							if (totalRows >= MAX_CSV_ROWS) {
								reject(new Error(`Too many rows (max ${MAX_CSV_ROWS.toLocaleString()})`));
								return;
							}

							// Validate row has same number of columns
							if (row.length !== columnCount) {
								console.warn(`Row ${rowIndex + 1} has ${row.length} columns, expected ${columnCount}. Padding/truncating.`);
							}

							// Collect preview rows (skip first if it's header)
							if (preview.length < 5) {
								/** @type {Record<string, string>} */
								const previewObj = {};
								headers.forEach((h, i) => (previewObj[h] = row[i] || ''));
								preview.push(previewObj);
							}
						}

						rowIndex++;
					} catch (error) {
						reject(error);
					}
				},
				complete: resolve,
				error: (error) => reject(new Error(`CSV parsing failed: ${error.message || 'Unknown error'}`)),
			});
		});

		// Adjust row count based on hasHeader
		const dataRowCount = hasHeader ? totalRows : totalRows + 1;


		// If CSV has no header, physically modify the file to add generic headers
		if (!hasHeader) {
			console.log('CSV has no header - adding generic headers to file');
			const tempPath = `${filePath}.temp`;
			const writeStream = fs.createWriteStream(tempPath);
			const readStream = fs.createReadStream(filePath);

			let firstRow = true;
			await new Promise((resolve, reject) => {
				Papa.parse(readStream, {
					header: false,
					skipEmptyLines: true,
					step: (results) => {
						const row = /** @type {string[]} */ (results.data);

						if (firstRow) {
							// Add header row at the beginning
							writeStream.write(Papa.unparse([headers]) + '\n');
							firstRow = false;
						}

						// Write the data row
						writeStream.write(Papa.unparse([row]) + '\n');
					},
					complete: () => {
						writeStream.end();
						resolve();
					},
					error: reject,
				});
			});

			// Replace original file with modified file
			fs.unlinkSync(filePath);
			fs.renameSync(tempPath, filePath);

			console.log('Generic headers added to CSV file');
		}


		// EMAIL DETECTION - Run immediately after parsing
		const columnScores = new Map();

		let detectionRowIndex = 0;
		let detectionTotalRows = 0;
		const detectionStream = fs.createReadStream(filePath);

		await new Promise((resolve, reject) => {
			Papa.parse(detectionStream, {
				header: false,
				skipEmptyLines: true,
				step: (results) => {
					const row = /** @type {string[]} */ (results.data);

					// Skip header row (file always has headers now after modification above)
					if (detectionRowIndex === 0) {
						detectionRowIndex++;
						return;
					}

					// Skip empty rows
					if (!row || row.length === 0 || row.every(cell => !cell || !cell.trim())) {
						detectionRowIndex++;
						return;
					}

					detectionTotalRows++;

					// Score each column using RFC 5322 compliant email validation
					row.forEach((value, columnIndex) => {
						const columnName = headers[columnIndex];

						if (!columnScores.has(columnName)) {
							columnScores.set(columnName, 0);
						}

						if (value && isValidEmail(value.trim())) {
							columnScores.set(columnName, columnScores.get(columnName) + 1);
						}
					});

					detectionRowIndex++;
				},
				complete: resolve,
				error: reject,
			});
		});

		// Find best column
		let bestColumn = null;
		let bestScore = 0;
		let bestColumnIndex = -1;

		for (let i = 0; i < headers.length; i++) {
			const column = headers[i];
			const score = columnScores.get(column) || 0;
			if (score > bestScore) {
				bestScore = score;
				bestColumn = column;
				bestColumnIndex = i;
			}
		}

		const confidence = detectionTotalRows > 0 ? (bestScore / detectionTotalRows) * 100 : 0;


		// Insert metadata into database with detection results
		const db = getDb();
		const now = Date.now();

		const stmt = db.prepare(`
            INSERT INTO csv_uploads
            (csv_upload_id, list_name, original_filename, file_path, file_size,
             has_header, headers, preview_data, row_count, column_count,
             selected_email_column, selected_email_column_index, column_scores, detection_confidence,
             upload_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

		stmt.run(
			csvUploadId,
			listName,
			originalFilename,
			filePath,
			req.file.size,
			1, // Always 1 - if originally no header, we added generic headers above
			JSON.stringify(headers),
			JSON.stringify(preview),
			dataRowCount,
			columnCount,
			bestColumn,
			bestColumnIndex,
			JSON.stringify(Object.fromEntries(columnScores)),
			confidence,
			'ready',
			now,
			now
		);

		return res.json({
			success: true,
			data: {
				csv_upload_id: csvUploadId,
				original_filename: originalFilename,
				list_name: listName,
				has_header: true, // Always true - we add generic headers if not present
				preview: preview,
				headers: headers,
				row_count: dataRowCount,
				column_count: columnCount,
				file_size: req.file.size,
				detected_column: bestColumn,
				detected_column_index: bestColumnIndex,
				confidence: parseFloat(confidence.toFixed(2)),
				column_scores: Object.fromEntries(columnScores),
				upload_status: 'ready',
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('CSV upload error:', errorMessage);

		// Clean up uploaded file on error
		if (req.file && req.file.path && fs.existsSync(req.file.path)) {
			fs.unlinkSync(req.file.path);
		}

		return res.status(400).json({
			success: false,
			message: errorMessage || 'CSV upload failed',
		});
	} finally {
		console.debug('CSV upload process completed');
	}
}


/**
 * Extract emails and submit for verification
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<import('express').Response | void>}
 */
async function submitCSVVerification(req, res) {
	try {
		const { csv_upload_id, email_column_index, field_mapping } = req.body;

		if (!csv_upload_id || email_column_index === undefined) {
			return res.status(400).json({
				success: false,
				message: 'CSV upload ID and email column index are required',
			});
		}

		// Get CSV upload from database (single-user system)
		const db = getDb();
		const upload = /** @type {CsvUploadRow | undefined} */ (
			db.prepare('SELECT * FROM csv_uploads WHERE csv_upload_id = ?').get(csv_upload_id)
		);

		if (!upload) {
			return res.status(404).json({
				success: false,
				message: 'CSV upload not found',
			});
		}

		const filePath = upload.file_path;
		const hasHeader = upload.has_header === 1;
		const headers = JSON.parse(upload.headers);
		const selectedColumn = headers[email_column_index];

		// Parse field_mapping: { first_name: colIndex, last_name: colIndex, ... }
		/** @type {Record<string, number>} */
		const mapping = field_mapping && typeof field_mapping === 'object' ? field_mapping : {};
		const ALLOWED_CONTACT_FIELDS = ['first_name', 'last_name', 'phone', 'linkedin_url', 'job_title', 'company_name'];

		// Update selected column in database (user might have changed it from auto-detected)
		const columnUpdateTime = Date.now();
		const updateColumnStmt = db.prepare(`
            UPDATE csv_uploads
            SET selected_email_column = ?,
                selected_email_column_index = ?,
                updated_at = ?
            WHERE csv_upload_id = ?
        `);

		updateColumnStmt.run(selectedColumn, email_column_index, columnUpdateTime, csv_upload_id);

		const stream = fs.createReadStream(filePath);

		let rowIndex = 0;
		/** @type {string[]} */
		const emails = [];
		/** @type {Record<string, Record<string, string>>} */
		const contactData = {};

		// Stream parse and extract emails + mapped contact fields
		await new Promise((resolve, reject) => {
			Papa.parse(stream, {
				header: false, // Manual parsing to avoid dot issues
				step: (results) => {
					const row = /** @type {string[]} */ (results.data);

					// Skip header row if hasHeader is true
					if (rowIndex === 0 && hasHeader) {
						rowIndex++;
						return;
					}

					// Extract email from selected column
					const email = row[email_column_index];

					if (email && email.trim()) {
						const trimmedEmail = email.trim();
						emails.push(trimmedEmail);

						// Extract mapped contact fields for this row
						const contact = /** @type {Record<string, string>} */ ({});
						for (const field of ALLOWED_CONTACT_FIELDS) {
							const colIdx = mapping[field];
							if (colIdx !== undefined && colIdx !== null) {
								const val = row[Number(colIdx)];
								if (val && val.trim()) contact[field] = val.trim();
							}
						}
						if (Object.keys(contact).length > 0) {
							contactData[trimmedEmail] = contact;
						}
					}

					rowIndex++;
				},
				complete: resolve,
				error: reject,
			});
		});

		// Persist contact data so saveValidEmails can use it after verification
		if (Object.keys(contactData).length > 0) {
			db.prepare('UPDATE csv_uploads SET contact_data = ?, updated_at = ? WHERE csv_upload_id = ?')
				.run(JSON.stringify(contactData), Date.now(), csv_upload_id);
		}

		// Generate verification request ID
		const verification_request_id = `csv-${uuidv4()}`;

		// Create verification request (single-user system)
		const createResult = await createVerificationRequest({
			verification_request_id,
			request_type: 'csv',
			emails: emails,
		});

		if (!createResult.success) {
			return res.status(500).json({
				success: false,
				message: 'Failed to create verification request',
			});
		}

		// Link CSV upload to verification request
		const linkUpdateTime = Date.now();
		const linkStmt = db.prepare(`
            UPDATE csv_uploads
            SET verification_request_id = ?,
                upload_status = ?,
                updated_at = ?
            WHERE csv_upload_id = ?
        `);

		linkStmt.run(verification_request_id, 'submitted', linkUpdateTime, csv_upload_id);

		// Add to verification queue
		const queueResult = await queue.add({
			request_id: verification_request_id,
			emails: emails,
			response_url: '', // Empty - we'll poll for results
		});

		if (!queueResult.success) {
			return res.status(500).json({
				success: false,
				message: 'Failed to add request to verification queue',
			});
		}

		// Update status to processing
		await updateVerificationStatus(verification_request_id, 'processing');

		return res.json({
			success: true,
			message: 'CSV verification started',
			data: {
				csv_upload_id: csv_upload_id,
				verification_request_id: verification_request_id,
				upload_status: 'submitted',
				verification_status: 'processing',
				total_emails: emails.length,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('CSV verification submission error:', errorMessage);

		return res.status(500).json({
			success: false,
			message: 'CSV verification submission failed',
		});
	} finally {
		console.debug('CSV verification submission process completed');
	}
}


/**
 * Download CSV with verification results
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<import('express').Response | void>}
 */
async function downloadCSVResults(req, res) {
	try {
		const { csv_upload_id } = req.params;

		if (!csv_upload_id) {
			return res.status(400).json({
				success: false,
				message: 'CSV upload ID is required',
			});
		}

		// Get CSV upload and verification request
		const db = getDb();
		const upload = /** @type {CsvUploadRow | undefined} */ (
			db
				.prepare(
					`
            SELECT c.*, v.emails as results
            FROM csv_uploads c
            LEFT JOIN verification_requests v ON c.verification_request_id = v.verification_request_id
            WHERE c.csv_upload_id = ?
        `
				)
				.get(csv_upload_id)
		);

		if (!upload) {
			return res.status(404).json({
				success: false,
				message: 'CSV upload not found',
			});
		}

		if (!upload.verification_request_id) {
			return res.status(400).json({
				success: false,
				message: 'CSV has not been submitted for verification',
			});
		}

		// Parse results (stored in emails column after completion)
		const resultsArray = upload.results ? JSON.parse(upload.results) : [];

		if (resultsArray.length === 0) {
			return res.status(400).json({
				success: false,
				message: 'Verification not yet completed or no results available',
			});
		}

		// Create email → result Map for O(1) lookup
		const resultsMap = new Map(resultsArray.map(r => [r.email, r]));

		const hasHeader = upload.has_header === 1;
		const emailColumnIndex = upload.selected_email_column_index;

		// Check if results have already been added to the CSV
		const headers = JSON.parse(upload.headers);
		const hasStatusColumns = headers.includes('status') && headers.includes('status_reason');

		// If status columns already exist, just download the file
		if (hasStatusColumns) {
			const downloadFilename = upload.list_name
				? `${upload.list_name}.csv`
				: upload.original_filename;

			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

			const fileStream = fs.createReadStream(upload.file_path);
			fileStream.pipe(res);
			return;
		}

		// Otherwise, modify the original CSV file to add status columns
		const tempPath = `${upload.file_path}.temp`;
		const writeStream = fs.createWriteStream(tempPath);
		const readStream = fs.createReadStream(upload.file_path);

		let rowIndex = 0;

		// Stream original CSV and append status columns
		await new Promise((resolve, reject) => {
			Papa.parse(readStream, {
				header: false, // Manual parsing
				step: (results) => {
					const row = /** @type {string[]} */ (results.data);

					if (rowIndex === 0 && hasHeader) {
						// First row is header - append status column headers
						row.push('status', 'status_reason');
					} else {
						// Data row - get email from selected column
						const email = row[emailColumnIndex];

						// Lookup result for this email
						const result = resultsMap.get(email) || {
							status: '',
							message: '',
						};

						// Append status columns
						row.push(result.status, result.message);
					}

					// Write row to output CSV
					writeStream.write(Papa.unparse([row]) + '\n');
					rowIndex++;
				},
				complete: () => {
					writeStream.end();
					resolve();
				},
				error: reject,
			});
		});

		// Replace original file with modified file
		fs.unlinkSync(upload.file_path);
		fs.renameSync(tempPath, upload.file_path);

		// Update headers in database
		headers.push('status', 'status_reason');
		const updateHeadersStmt = db.prepare(`
			UPDATE csv_uploads
			SET headers = ?, updated_at = ?
			WHERE csv_upload_id = ?
		`);
		updateHeadersStmt.run(JSON.stringify(headers), Date.now(), csv_upload_id);

		// Download response - use list_name if available, otherwise original_filename
		const downloadFilename = upload.list_name
			? `${upload.list_name}.csv`
			: upload.original_filename;

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

		const fileStream = fs.createReadStream(upload.file_path);
		fileStream.pipe(res);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('CSV download error:', errorMessage);

		return res.status(500).json({
			success: false,
			message: 'CSV download failed',
		});
	} finally {
		console.debug('CSV download process completed');
	}
}


// Export functions and multer upload middleware
module.exports = {
	upload,
	uploadCSV,
	submitCSVVerification,
	downloadCSVResults,
};
