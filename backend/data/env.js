/**
 * Environment variables configuration and validation
 * Centralizes all environment variable access and provides validation
 * Auto-generates secrets if missing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generate a random secret key
 * @returns {string} Random base64 encoded string
 */
function generateSecret() {
	return crypto.randomBytes(32).toString('base64');
}

/**
 * Append environment variable to .env file
 * @param {string} key - Environment variable name
 * @param {string} value - Environment variable value
 * @returns {void}
 */
function appendToEnvFile(key, value) {
	try {
		const envPath = path.join(__dirname, '..', '.env');
		const timestamp = new Date().toISOString();
		const envLine = `\n# Auto-generated on ${timestamp}\n${key}=${value}\n`;

		fs.appendFileSync(envPath, envLine, 'utf8');
		console.log(`✅ Auto-generated ${key} and added to .env file`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to write ${key} to .env file:`, errorMessage);
	}
}

/**
 * Validates and returns an environment variable value
 * Auto-generates secrets if they don't exist
 * @param {string} key - Environment variable name
 * @param {string} [defaultValue] - Default value if environment variable is not set
 * @param {boolean} [required=true] - Whether the variable is required
 * @param {boolean} [autoGenerate=false] - Whether to auto-generate secret if missing
 * @returns {string} Environment variable value
 * @throws {Error} If required environment variable is missing
 */
function getEnvVar(key, defaultValue = null, required = true, autoGenerate = false) {
	try {
		let value = process.env[key];

		// Auto-generate secret if missing and autoGenerate is true
		if (!value && autoGenerate) {
			const generatedSecret = generateSecret();
			appendToEnvFile(key, generatedSecret);
			process.env[key] = generatedSecret;
			value = generatedSecret;
		}

		if (!value && required && !defaultValue) {
			throw new Error(`Required environment variable ${key} is not set`);
		}

		return value || defaultValue;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Environment variable error:', errorMessage);
		throw error;
	}
}

// Database configuration

const DB_PATH = getEnvVar('DB_PATH', '.sql/user_auth.db', false);

// Server configuration

const PORT = getEnvVar('PORT', '5000', false);

// Security configuration

const CORS_ORIGIN = getEnvVar('CORS_ORIGIN', 'http://localhost:5173', false);

// Session configuration

const SESSION_SECRET = getEnvVar('SESSION_SECRET', null, true, true); // Auto-generate if missing
const SESSION_MAX_AGE = parseInt(getEnvVar('SESSION_MAX_AGE', '86400000', false), 10);

// Admin authentication

const ADMIN_EMAIL = getEnvVar('ADMIN_EMAIL', 'your-personal-email@domain.com', false);
const ADMIN_PASSWORD = getEnvVar('ADMIN_PASSWORD', 'your-verifier-password', false);

// CSV upload limits

const MAX_CSV_ROWS = getEnvVar('MAX_CSV_ROWS', '100000', false);
const MAX_CSV_SIZE_MB = getEnvVar('MAX_CSV_SIZE_MB', '100', false);

// Email verification configuration
// These are validated by validateEnvironment() - will throw if not set

const MX_DOMAIN = getEnvVar('MX_DOMAIN', '', false);
const EM_DOMAIN = getEnvVar('EM_DOMAIN', '', false);

// Third-party scraping integrations

const BRIGHTDATA_API_KEY = getEnvVar('BRIGHTDATA_API_KEY', '', false);
const BRIGHTDATA_SERP_KEY = getEnvVar('BRIGHTDATA_SERP_KEY', '', false);

/**
 * Validates all required environment variables
 * @returns {boolean} True if all required variables are present
 * @throws {Error} If any required environment variable is missing
 */
function validateEnvironment() {
	try {
		const requiredVars = ['MX_DOMAIN', 'EM_DOMAIN'];

		const missingVars = [];

		for (const varName of requiredVars) {
			if (!process.env[varName] || process.env[varName].trim() === '') {
				missingVars.push(varName);
			}
		}

		if (missingVars.length > 0) {
			console.error('\n❌ FATAL ERROR: Missing required environment variables!\n');
			console.error('The following environment variables are REQUIRED for the application to run:');
			missingVars.forEach(varName => {
				console.error(`  - ${varName}`);
			});
			console.error('\nPlease set these variables in your .env file before starting the server.');
			console.error('See .env.example for reference.\n');
			throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
		}

		console.log('✅ Environment validation successful');
		return true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Environment validation failed:', errorMessage);
		throw error;
	}
}

// Export all environment variables and utilities
module.exports = {
	// Database
	DB_PATH,

	// Server
	PORT,

	// Security
	CORS_ORIGIN,

	// Session
	SESSION_SECRET,
	SESSION_MAX_AGE,

	// Admin authentication
	ADMIN_EMAIL,
	ADMIN_PASSWORD,

	// CSV upload limits
	MAX_CSV_ROWS: parseInt(MAX_CSV_ROWS, 10),
	MAX_CSV_SIZE_MB: parseInt(MAX_CSV_SIZE_MB, 10),

	// Email verification
	MX_DOMAIN,
	EM_DOMAIN,

	// Integrations
	BRIGHTDATA_API_KEY,
	BRIGHTDATA_SERP_KEY,

	// Utilities
	getEnvVar,
	validateEnvironment,
};
