/**
 * Email Verifier API routes
 * Provides endpoints for email verification status and results queries
 *
 * This module provides:
 * - Single email verification endpoints (verifySingleEmail)
 * - CSV bulk verification endpoints (uploadCSV with detection, submitCSVVerification, downloadCSVResults)
 * - API programmatic verification endpoint (verifyApiRequest)
 * - Separate status and results endpoints for ALL verification types
 * - Verification history endpoints (getHistory)
 * - Health check endpoint
 */

const express = require('express');
const { authenticateApiKey } = require('../../functions/middleware/authenticateApiKey');
const { isAuthenticated } = require('../../functions/middleware/authenticate');
const { authenticateEither } = require('../../functions/middleware/authenticateEither');
const { verifySingleEmail } = require('../../functions/route_fns/verify/singleEmailVerification');
const { verifyApiRequest } = require('../../functions/route_fns/verify/apiVerification');
const {
	upload,
	uploadCSV,
	submitCSVVerification,
	downloadCSVResults,
} = require('../../functions/route_fns/verify/bulkCSVVerification');
const { getVerificationStatus } = require('../../functions/route_fns/verify/verificationStatus');
const { getVerificationResults } = require('../../functions/route_fns/verify/verificationResults');
const { getHistory } = require('../../functions/route_fns/verify/verificationHistory');
const { getValidEmails } = require('../../functions/route_fns/verify/verificationDB');
const { findEmail } = require('../../functions/route_fns/verify/findEmail');
const { checkPort25Connectivity } = require('../../functions/verifier/utils/checkPort25');
const { MAX_CSV_SIZE_MB } = require('../../data/env');

// Create Express router instance
const router = express.Router();

/**
 * POST /api/verifier/verify-single
 * Verify a single email address
 * Requires authentication
 *
 * @function verifySingleEmail - From singleEmailVerification.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with verification request ID
 */
router.post('/verify-single', isAuthenticated, verifySingleEmail);

/**
 * GET /api/verifier/find-email?firstName=&lastName=&domain=
 * SSE stream — emits attempt/found/done events per pattern
 */
router.get('/find-email', isAuthenticated, findEmail);

/**
 * POST /api/verifier/v1/verify
 * API v1: Programmatic email verification with API key authentication
 * Submit multiple emails as JSON array with optional webhook URL
 * Requires API key authentication
 *
 * Request body:
 * - emails: string[] (required, 1-10000 emails)
 * - responseUrl: string (optional, webhook URL for results)
 *
 * @function verifyApiRequest - From apiVerification.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends 202 Accepted with verification request ID
 */
router.post('/v1/verify', authenticateApiKey, verifyApiRequest);

/**
 * GET /api/verifier/verification/:verification_request_id/status
 * Get verification status and progress for ANY request type (single, CSV, or API)
 * Returns ONLY status and progress information - NO results
 * Requires authentication (session OR API key)
 *
 * @function getVerificationStatus - From verificationStatus.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with verification status and progress
 */
router.get('/verification/:verification_request_id/status', authenticateEither, getVerificationStatus);

/**
 * GET /api/verifier/verification/:verification_request_id/results
 * Get verification results for ANY verification status
 * While processing: returns status info (allows single-endpoint polling)
 * When completed: returns results with pagination (default 20 items per page)
 * Requires authentication (session OR API key)
 * Query params: ?page=1&per_page=20
 *
 * @function getVerificationResults - From verificationResults.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with status or paginated results
 */
router.get('/verification/:verification_request_id/results', authenticateEither, getVerificationResults);

/**
 * POST /api/verifier/csv/upload
 * Upload CSV file and detect email column in one step
 * Requires authentication
 * Body parameters: csvFile (file), list_name (string), has_header (boolean)
 *
 * @function uploadCSV - From bulkCSVVerification.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with CSV upload details and email detection results
 */
router.post(
	'/csv/upload',
	isAuthenticated,
	upload.single('csvFile'),
	(err, req, res, next) => {
		if (err) {
			if (err.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({
					success: false,
					message: `File too large. Maximum size is ${MAX_CSV_SIZE_MB}MB`,
				});
			}
			if (err.message === 'Only CSV files allowed') {
				return res.status(400).json({
					success: false,
					message: 'Only CSV files are allowed',
				});
			}
			return res.status(400).json({
				success: false,
				message: err.message || 'File upload failed',
			});
		}
		next();
	},
	uploadCSV
);

/**
 * POST /api/verifier/csv/verify
 * Submit CSV for email verification
 * Requires authentication
 *
 * @function submitCSVVerification - From bulkCSVVerification.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with verification request details
 */
router.post('/csv/verify', isAuthenticated, submitCSVVerification);

/**
 * GET /api/verifier/csv/:csv_upload_id/download
 * Download CSV with verification results
 * Requires authentication
 *
 * @function downloadCSVResults - From bulkCSVVerification.js
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends CSV file with results
 */
router.get('/csv/:csv_upload_id/download', isAuthenticated, downloadCSVResults);

/**
 * GET /api/verifier/history
 * Get verification history with time-based filters
 * Requires authentication
 * Query params: ?page=1&per_page=50&period=this_month
 * Period options: this_month, last_month, last_6_months
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends JSON response with paginated history
 */
router.get('/history', isAuthenticated, getHistory);

/**
 * GET /api/verifier/valid-emails
 * Get all valid emails grouped by domain
 * Query params: ?page=1&per_page=50&domain=example.com
 */
router.get('/valid-emails', isAuthenticated, (req, res) => {
	try {
		const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
		const perPage = Math.min(200, Math.max(1, parseInt(String(req.query.per_page || '50'), 10)));
		const domain = typeof req.query.domain === 'string' ? req.query.domain : null;

		const data = getValidEmails(page, perPage, domain);

		if (!data) {
			return res.status(500).json({ success: false, message: 'Failed to retrieve valid emails' });
		}

		return res.json({ success: true, data });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Valid emails endpoint error:', errorMessage);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	} finally {
		console.debug('Valid emails endpoint process completed');
	}
});

/**
 * GET /api/verifier/health
 * Health check endpoint for verifier service monitoring
 *
 * @param {import('express').Request} _req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends health status JSON response
 */
router.get('/health', (_req, res) => {
	try {
		const healthData = {
			success: true,
			message: 'Verifier service is healthy',
			timestamp: new Date().toISOString(),
			service: 'verifier-api',
			version: '1.0.0',
			uptime: process.uptime(),
		};

		return res.json(healthData);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Verifier health check failed:', {
			error: errorMessage,
			timestamp: new Date().toISOString(),
		});

		return res.status(500).json({
			success: false,
			message: 'Verifier service health check failed',
			timestamp: new Date().toISOString(),
		});
	} finally {
		console.debug('Verifier health check process completed');
	}
});


/**
 * GET /api/verifier/port25-check
 * Check if outbound port 25 (SMTP) is accessible
 * Used to verify if email verification can be performed
 * Requires authentication (session OR API key)
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends port 25 connectivity test results
 */
router.get('/port25-check', authenticateEither, async (req, res) => {
	try {
		const result = await checkPort25Connectivity();

		return res.json({
			success: true,
			data: result
		});

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Port 25 check failed:', {
			error: errorMessage,
			timestamp: new Date().toISOString()
		});

		return res.status(500).json({
			success: false,
			message: 'Port 25 connectivity check failed',
			error: errorMessage
		});

	} finally {
		console.debug('Port 25 check process completed');
	}
});


// Comprehensive error handling middleware for verifier routes

/**
 * Error handling middleware for verifier routes
 * Handles different error types with appropriate HTTP status codes
 *
 * @param {Error} error - Error object
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} _next - Express next function
 * @returns {Promise<void>} Sends error response or calls next
 */
router.use((error, req, res, _next) => {
	try {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const requestInfo = {
			method: req.method,
			url: req.url,
			ip: req.ip,
			userAgent: req.get('User-Agent'),
			timestamp: new Date().toISOString(),
		};

		console.error('Verifier route error:', {
			error: errorMessage,
			request: requestInfo,
		});

		// Handle specific error types with appropriate status codes
		if (error.name === 'ValidationError') {
			return res.status(400).json({
				success: false,
				message: 'Request validation failed',
				error: errorMessage,
			});
		}

		// Generic server error with minimal information exposure
		return res.status(500).json({
			success: false,
			message: 'Internal server error occurred',
		});
	} catch (handlerError) {
		const handlerErrorMessage = handlerError instanceof Error ? handlerError.message : String(handlerError);
		console.error('Verifier error handler failed:', {
			originalError: error instanceof Error ? error.message : String(error),
			handlerError: handlerErrorMessage,
			timestamp: new Date().toISOString(),
		});

		return res.status(500).json({
			success: false,
			message: 'Critical system error',
		});
	} finally {
		console.debug('Verifier error handling process completed');
	}
});

// Export configured verifier router
module.exports = router;
