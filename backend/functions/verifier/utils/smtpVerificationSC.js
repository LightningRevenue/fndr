const tls = require('tls');
const net = require('net');
const winston = require('winston');
const { loggerTypes } = require('../../logging/logger');
const promiseAwaitMs = require('../../utils/promiseAwaitMs');
const smtpErrors = require('../../../data/errors/smtpErrors');
const { debounce, clone } = require('lodash');
const { parseSMTPError, parseSmtpErrorEnhanced } = require('./parseSMTPError');
const { v4: uuidv4 } = require('uuid');
const emailSplit = require('../../utils/emailSplit');
const { mx_domain, em_domain } = require('../../../data/stateVariables');
const catchAllCache = require('./catchAllCache');
const { checkGreylisting, analyzeGreylisting } = require('./checkGreylisting');
const cloneFunction = require('../../utils/cloneFunction');

/**
 * SMTP connection stages
 * @readonly @enum {number}
 */
const SMTPStages = {
	ehlo: 0,
	mailFrom: 1,
	rcptTo: 2,
};

/**
 * This class performs a SMTP verification using the Single connect method
 * - The function performs a single SMTP server connect
 * - The function then attempts to verify multiple emails by sending multiple FROM fields
 * - The function reconnects to the SMTP server in case of a disconnect.
 */
class SMTPVerificationSC {
	/** EHLO name @private @type {string} */
	_ehlo = '';
	/** FROM domain @private @type {string} */
	_fromDomain = '';
	/** SMTP port @private @type {number} */
	_smtp_port = 25;
	/** SMTP stage @private @type {number} */
	_smtp_stage = SMTPStages.ehlo;
	/** SMTP client connected to @private @type {net.Socket} */
	_client;
	/** TLS secure SMTP client @private @type {tls.TLSSocket | undefined} */
	_secureClient;
	/** Timeout for connections & inactivity */
	_timeout = 15000; // 15 seconds (keep original timeout)
	/** The Email addresses to verify @private @type {string[]} */
	_emailsToVerify;

	/** SMTP report per email @private @type {Map<string, { email: string, host_exists: boolean, full_inbox: boolean, catch_all: boolean, catch_all_blocked: boolean, deliverable: boolean, disabled: boolean, error: boolean, errorMsg: {details: string, message: string}, done: boolean, greylisted: boolean, requires_recheck: boolean}>} */
	smtpReports;
	/** Calculated result @private @type {boolean} */
	_calculatedResult = false;
	/** Fallback attempt for EHLO @private @type {boolean} */
	_usedEhloFallback = false;
	/** Waiting for a response to FROM @private @type {boolean} */
	_waitingForFrom = false;
	/** Start verification process in the RCPT block @private @type {boolean} */
	_start_verification = false;
	/** Waiting for verification for @private @type {boolean} */
	_waiting_for_verification = false;
	/** Email verification sequence to be checked @private @type {string[]} */
	_email_verification_seq = [];
	/** index of email in the email verifcation sequence @private @type {number} */
	_email_verification_seq_index = 0;

	/**
	 * @enum {string}
	 */
	EmailVerificationPhase = {
		PENDING: 'pending',
		TESTING_CATCHALL: 'testing_catchall',
		CATCHALL_COMPLETED: 'catchall_completed',
		TESTING_EMAIL: 'testing_email',
		COMPLETED: 'completed',
		FAILED: 'failed',
	};

	/**
	 * @typedef {Object} EmailVerificationJob
	 * @property {string} email - The actual email being verified
	 * @property {string} randomEmail - Random email for catch-all testing
	 * @property {string} phase - Current verification phase
	 * @property {boolean} catchAllResult - Result of catch-all test
	 * @property {Object} verificationResult - Final verification result
	 * @property {number} attempts - Number of verification attempts
	 * @property {string} currentTestEmail - Email currently being tested
	 */

	/** Job-based verification queue @private @type {EmailVerificationJob[]} */
	_verificationQueue = [];
	/** Current job index @private @type {number} */
	_currentJobIndex = 0;
	/** Current verification job being processed @private @type {EmailVerificationJob | null} */
	_currentJob = null;
	/** State-based email verification tracking @private @type {Map<string, EmailVerificationJob>} */
	_emailStates = new Map();
	/** Max reconnection attempts @private @type {number} */
	_max_reconnections = 3;
	/** Reconnection attempts @private @type {number} */
	_reconnections = 0;
	/** Voluntary disconnect @private @type {boolean} */
	_self_disconnect = false;
	/** Track retry attempts per email @private @type {Map<string, number>} */
	_emailRetryCount = new Map();
	/** Maximum retries per email @private @type {number} */
	_maxRetriesPerEmail = 2;
	/** Track domains with relay issues @private @type {Map<string, {count: number, lastAttempt: number}>} */
	_relayBlockedDomains = new Map();
	/**
	 * @typedef {Object} TimerState
	 * @property {NodeJS.Timeout|null} socketTimer
	 * @property {NodeJS.Timeout|null} inactivityTimer
	 * @property {number} lastActivity
	 * @property {boolean} expectingResponse
	 * @property {string} currentStage - Current SMTP stage for context-aware timer management
	 */

	/**
	 * Centralized timer management
	 * @private
	 * @type {TimerState}
	 */
	_timerState = {
		socketTimer: null,
		inactivityTimer: null,
		lastActivity: 0,
		expectingResponse: false,
		currentStage: 'idle',
	};

	/** Logger @type {winston.Logger} */
	logger;

	// STATE VARAIBLES
	/** Client is connected @private @type {boolean} */
	_clientConnected = false;
	/** Requested server to STARTTLS @private @type {boolean} */
	_startTLS_requested = false;
	/** TLS connection live @private @type {boolean} */
	_tls_connection_active = false;

	/**
	 * @param {number | undefined} workerIndex
	 */
	constructor(workerIndex = undefined) {
		this._client = new net.Socket();
		this._ehlo = mx_domain;
		this._fromDomain = em_domain;
		this.smtpReports = new Map();
		this._emailsToVerify = [];

		// configure the logger
		this.logger =
			workerIndex === 0
				? winston.loggers.get(loggerTypes.smtp0)
				: workerIndex === 1
				? winston.loggers.get(loggerTypes.smtp1)
				: workerIndex === 2
				? winston.loggers.get(loggerTypes.smtp2)
				: workerIndex === 3
				? winston.loggers.get(loggerTypes.smtp3)
				: winston.loggers.get(loggerTypes.smtp);

		/** @private @type {string[]} Buffer to accumulate SMTP response fragments */
		this._responseBuffer = [];
		/** @private @type {boolean} Flag to indicate if we're processing a multi-line response */
		this._processingMultiLine = false;
		/** @private @type {NodeJS.Timeout | null} Timer for delayed response processing */
		this._responseTimer = null;

		// Enhanced debounced handler with response buffer management
		// TEMPORARILY DISABLE DEBOUNCE TO TEST TIMEOUT ISSUE - debounce may cause 300ms delay that triggers timeout
		this.debouncedHandleData = this.processBufferedResponse.bind(this); // debounce(this.processBufferedResponse.bind(this), 300);
	}

	/**
	 * perform smtp verification for emails with the provided MX records
	 * @param {string[]} emails
	 * @param {{Host: string, Pref: number}[]} mx_records
	 */
	async check(emails, mx_records) {
		this.reset(true); // reset everything
		try {
			// create the email verification sequence - random email for domain followed by the email itself + create report template
			for (const email of emails) {
				// create & add the random email
				const { domain } = emailSplit(email);
				const randEmail = this.randEmail(domain);
				this._email_verification_seq.push(randEmail);

				// add the email
				this._email_verification_seq.push(email);

				// Create verification job
				const job = {
					email: email,
					randomEmail: randEmail,
					phase: this.EmailVerificationPhase.PENDING,
					catchAllResult: false,
					verificationResult: {},
					attempts: 0,
					currentTestEmail: randEmail, // Start with catch-all test
				};

				this._verificationQueue.push(job);
				this._emailStates.set(email, job);

				// create dummy result map
				this.smtpReports.set(email, {
					email: email,
					host_exists: false, // done
					full_inbox: false,
					catch_all: false,
					catch_all_blocked: false,
					deliverable: false,
					disabled: false, // true if unable to verify because of blacklist
					error: false,
					errorMsg: { details: '', message: '' },
					done: false, // this marks whether this email has been processed or not
					greylisted: false, // whether the email is greylisted
					requires_recheck: false,
				});
			}

			// email addresses to verify
			this._emailsToVerify = emails || [];

			// connect with each MX server one by one until all the emails have been checked
			for (const mx_record of mx_records) {
				this.logger.debug(`Running SMTP connection once -> ${mx_record.Host}`);
				this.reset();

				// SMTP server details
				const smtpHost = mx_record.Host || '';

				if (smtpHost) {
					// The promise.race condition has been removed since multiple emails may be verified at once

					// handle smtp connection and handle disconnections + implement a race condition
					await new Promise(res => {
						try {
							// clean up the client and TLS client if there are any traces
							// if (this._secureClient) {
							// 	this._secureClient.removeAllListeners();
							// 	this._secureClient.destroy();
							// 	this._secureClient = undefined;
							// }

							// Setup event listeners BEFORE connecting to avoid missing initial responses
							// timeout condition
							this._client.setTimeout(this._timeout);

							/**
							 * Event listeners must be attached BEFORE connecting to avoid race conditions
							 * where the initial server response (220) arrives before listeners are ready
							 */

							// timeout
							const onTimeout = () => {
								const timeoutMsg = `⏰ SOCKET TIMEOUT after ${this._timeout}ms. Stage: ${this._smtp_stage}. Host: ${smtpHost}`;
								console.log(timeoutMsg);
								this.logger.warn(timeoutMsg);

								// Handle the idle timeout as needed, e.g., end the connection
								this.updateResults(
									{
										error: true,
										errorMsg: {
											message: smtpErrors.ErrTimeout,
											details:
												'Socket idle timeout. No activity detected for ' +
												this._timeout +
												' ms',
										},
									},
									false
								);

								this._self_disconnect = true;
								if (this._client) {
									this._client.end();
									this._client.destroy(); // destroy everything about the connection
								}
								res(true);
							};
							this._client.on('timeout', onTimeout);

							// data
							const onData = (/** @type {Buffer} */ data) => {
								// reset the timeout so it waits for inactivity
								if (this._client) this._client.setTimeout(this._timeout);

								// reset timeout
								this.resetInactivityTimer(); // This is a hardcoded timeout kill switch

								// this is debounced
								this.callDebouncedHandleData(data.toString(), res, smtpHost);
							};
							this._client.on('data', onData);

							// close
							const onClose = async () => {
								// console.log(`🔌 CONNECTION CLOSED to ${smtpHost} in TCP connect`);
								// this.logger.info(`🔌 CONNECTION CLOSED to ${smtpHost} in TCP connect`);
								this._clientConnected = false;

								// destroy the connection before retrying
								this._client.destroy();

								// wait till the TLS connection closes
								while (true) {
									await promiseAwaitMs(100);
									if (!this._tls_connection_active) break;
								}

								// attempt to connect to the MX server again if we are not done processing all of them
								const reconnectionSuccess = await this.reconnect(smtpHost);
								if (!reconnectionSuccess) {
									// clear manual timeout
									this.clearAllTimers();
									this._client?.removeAllListeners();
									res(true);
								}
							};
							this._client.on('close', onClose);

							// error
							const onError = async (/** @type {any} */ error) => {
								// console.log(`❌ CLIENT ERROR: ${error?.toString()}`);
								this.logger.error('Client Error: ' + error?.toString());
								this._clientConnected = false;

								// destroy the connection before retrying
								this._client.destroy();

								if (error?.toString()?.indexOf('AggregateError') !== -1) {
									for (const individualError of error?.errors) {
										this.logger?.error('  ', individualError);
									}
								}

								// handle address already in use error
								if (
									error?.code === 'EADDRINUSE' ||
									error?.code === 'EALREADY' ||
									error?.code === 'ECONNRESET' ||
									error?.code === 'EPIPE' ||
									error?.code === 'EAI_AGAIN' // unlike the rest this is a network error and may hault the code - leave only if it works
								) {
									await promiseAwaitMs(1000); // Retry after 1 second
									const reconnectionSuccess = await this.reconnect(smtpHost, true); // don't count the reconnect
									if (!reconnectionSuccess) {
										res(true);
									}
								} else {
									// attempt to connect to the MX server again if we are not done processing all of them
									const reconnectionSuccess = await this.reconnect(smtpHost);
									if (!reconnectionSuccess) {
										// clear manual timeout
										this.clearAllTimers();

										this._client?.removeAllListeners();

										res(true);
									}
								}
							};
							this._client.on('error', onError);

							// NOW connect to the server after all event listeners are attached
							// console.log(`🔌 CONNECTING to ${smtpHost}:${this._smtp_port}`);
							// this.logger.info(`🔌 CONNECTING to ${smtpHost}:${this._smtp_port}`);
							this._client.connect(this._smtp_port, smtpHost, () => {
								// console.log(`✅ CONNECTED to SMTP server ${smtpHost}`);
								// this.logger.info(`✅ CONNECTED to SMTP server ${smtpHost}`);
								this._clientConnected = true;

								// mark the host exists to be true for all SMTP reports
								this.updateResults({ host_exists: true });
							});
						} catch (error) {
							console.trace(error);
						}
					});
				}

				if (this._calculatedResult) break;
				else await promiseAwaitMs(1000); // wait for 1s
			}
		} catch (error) {
			this.logger.error(`check() error -> ${error?.toString()}`);
		} finally {
			console.log('SMTP report from module -> ');
			console.dir(this.smtpReports, { depth: null });
			return this.smtpReports;
		}
	}

	////////////////////////////////////////////////////
	// EVENT LISTENERS
	////////////////////////////////////////////////////

	/**
	 * This function will upgrade the connection to TLS
	 * @param {string} smtpHost
	 * @param {(value: any) => void} res
	 */
	async upgradeConnection(smtpHost, res) {
		let success = false;
		try {
			this.logger.debug('Upgrading connection...');

			await new Promise(resolve => {
				this._secureClient = tls.connect(
					{
						socket: this._client,
						servername: smtpHost,

						minVersion: 'TLSv1.3', // Specify minimum TLS version
						maxVersion: 'TLSv1.3', // Specify maximum TLS version
						rejectUnauthorized: false, // Disable certificate verification for testing
					},
					() => {
						this.logger.debug('Connection secured with TLS');
						this._tls_connection_active = true; // mark that tls connection has been established

						if (this._secureClient) {
							// Reassign event handlers to the new secure socket
							this._secureClient.setTimeout(this._timeout);

							// timeout
							const onTimeout = () => {
								this.logger.warn(
									'Socket idle timeout. No activity detected for ' + this._timeout + ' ms'
								);

								// Handle the idle timeout as needed, e.g., end the connection
								this.updateResults(
									{
										error: true,
										errorMsg: {
											message: smtpErrors.ErrTimeout,
											details:
												'Socket idle timeout. No activity detected for ' +
												this._timeout +
												' ms',
										},
									},
									false
								);

								this._self_disconnect = true;
								if (this._secureClient) {
									this._secureClient.end();
									this._secureClient.destroy(); // destroy everything about the connection
								}

								this._tls_connection_active = false;

								resolve(true);
							};
							this._secureClient.on('timeout', onTimeout);

							// data
							const onData = (/** @type {Buffer} */ data) => {
								// reset the timeout so it waits for inactivity
								if (this._secureClient) this._secureClient.setTimeout(this._timeout);

								// reset timeout
								this.resetInactivityTimer(); // This is a hardcoded timeout kill switch

								// this is debounced
								this.callDebouncedHandleData(data.toString(), resolve, smtpHost);
							};
							this._secureClient.on('data', onData);

							// close
							const onClose = async () => {
								this.logger.debug(`Connection to ${smtpHost} closed in TLS`);
								this._clientConnected = false;

								// destroy the connection before retrying
								if (this._secureClient) {
									this._secureClient.removeAllListeners();
									this._secureClient.destroy();
									this._secureClient = undefined;
								}

								this.clearAllTimers();

								this._tls_connection_active = false;

								resolve(true);
							};
							this._secureClient.on('close', onClose);
						}
					}
				);

				const onError = async (/** @type {any} */ error) => {
					this.logger.error('Client Error: ' + error?.toString());
					console.error('Client Errorrr: ', error);
					this._clientConnected = false;

					// destroy the connection before retrying
					if (this._secureClient) {
						this._secureClient.removeAllListeners();
						this._secureClient.destroy();
						this._secureClient = undefined;
					}

					if (error?.toString()?.indexOf('AggregateError') !== -1) {
						for (const individualError of error?.errors) {
							this.logger?.error('  ', individualError);
						}
					}

					this.clearAllTimers();

					this._tls_connection_active = false;

					resolve(true);
				};
				this._secureClient.on('error', err => {
					this.logger.error('TLS connection error:', err);
					onError(err);
				});

				// start with EHLO again
				const command = `EHLO ${this._ehlo}`;
				// console.log(`📤 TLS SENDING: ${command}`);
				// this.logger.info(`📤 TLS SENDING: ${command}`);
				this._secureClient.write(`${command}\r\n`); // Replace with your domain
				success = true;
			});

			res(true);
		} catch (error) {
			this.logger.error(`upgradeConnection() error -> ${error?.toString()}`);
			console.error('upgradeConnection() error -> ', error);
			this._secureClient = undefined; // reset the secure client
		} finally {
			return success;
		}
	}

	////////////////////////////////////////////////////

	/**
	 * Enhanced data handling with response buffering for fragmented SMTP responses
	 * @private
	 * @param {string} dataStr
	 * @param {(value: any) => void} res
	 * @param {string} smtpHost
	 */
	callDebouncedHandleData(dataStr, res, smtpHost) {
		// Add response to buffer and log it immediately
		// console.log(`📨 RAW DATA FRAGMENT: ${JSON.stringify(dataStr)}`);
		this._responseBuffer.push(dataStr);

		// Enhanced multi-line response detection
		const trimmedData = dataStr.trim();
		const lines = trimmedData.split('\r\n').filter(line => line.length > 0);

		// console.log(`🔍 MULTILINE CHECK: Lines=${lines.length}, Processing=${this._processingMultiLine}`);

		// Check if ANY line has continuation marker (-)
		const hasContinuation = lines.some(line => line.length >= 4 && line.charAt(3) === '-');
		// Check if we have a final line (no continuation marker)
		const hasFinalLine = lines.some(line => line.length >= 4 && line.charAt(3) === ' ');

		if (hasContinuation && !hasFinalLine) {
			// console.log(`🔍 MULTILINE: Waiting for more data (continuation found, no final line)`);
			this._processingMultiLine = true;
			return; // Wait for more data
		}

		if (hasContinuation && hasFinalLine) {
			// console.log(`🔍 MULTILINE: Complete response detected`);
			this._processingMultiLine = false;
			this.processBufferedResponse(res, smtpHost);
			return;
		}

		// SIMPLIFIED: Process immediately without any delays
		this.processBufferedResponse(res, smtpHost);
	}

	/**
	 * Check if response requires immediate processing
	 * @private
	 * @param {string} response
	 * @returns {boolean}
	 */
	isCriticalResponse(response) {
		const trimmed = response.trim();
		return (
			trimmed.startsWith('250') || // Success responses
			trimmed.startsWith('550') || // Permanent failure
			trimmed.startsWith('554') || // Transaction failed
			trimmed.startsWith('220') || // Service ready
			trimmed.startsWith('221') || // Service closing
			trimmed.toLowerCase().includes('quit')
		); // Connection termination
	}

	/**
	 * Process buffered SMTP responses
	 * @private
	 * @param {(value: any) => void} res
	 * @param {string} smtpHost
	 */
	async processBufferedResponse(res, smtpHost) {
		if (this._responseBuffer.length === 0) return;

		// Combine all buffered responses
		const combinedResponse = this._responseBuffer.join('\r\n');
		// console.log(`🔄 PROCESSING BUFFERED RESPONSE (${this._responseBuffer.length} fragments): ${combinedResponse.trim()}`);
		// this.logger.info(`🔄 PROCESSING BUFFERED RESPONSE (${this._responseBuffer.length} fragments): ${combinedResponse.trim()}`);

		// Clear the buffer
		this._responseBuffer = [];

		// Clear response timer if it exists
		if (this._responseTimer) {
			clearTimeout(this._responseTimer);
			this._responseTimer = null;
		}

		// Process the combined response
		await this.handleData(combinedResponse, res, smtpHost);
	}

	/**
	 * Enhanced function to handle SMTP data with proper response processing
	 * @private
	 * @param {string} dataStr
	 * @param {(value: any) => void} res
	 * @param {string} smtpHost
	 */
	async handleData(dataStr, res, smtpHost) {
		// wait if the SMTP server tells you to wait - but only if it's ONLY a wait message
		// Don't ignore complete multiline responses that include both wait and ready messages
		const lines = dataStr.split('\r\n').filter(line => line.trim().length > 0);
		const hasWaitOnly = lines.length === 1 && dataStr?.toLowerCase()?.includes('wait');
		const hasReadyMessage = lines.some(
			line =>
				line.startsWith('220 ') ||
				line.toLowerCase().includes('welcome') ||
				line.toLowerCase().includes('ready')
		);

		if (hasWaitOnly && !hasReadyMessage) {
			this.logger.debug(`Ignored Wait-Only Block: ${dataStr}`);
			return; // ignore this command completely
		}

		if (this._smtp_stage === SMTPStages.ehlo) {
			// console.log(`🔍 EHLO STAGE - Processing data: ${JSON.stringify(dataStr.trim())}`);
			// run the ehlo handler here
			const response = await this.handleEHLO(dataStr.trim());
			if (response && response.err === true) {
				// exit the code here
				await this.disconnect();
				res(true);
			}
		}

		// check if a STARTTLS interraction is required
		// if (
		// 	(dataStr?.toLowerCase()?.includes('starttls') || this._startTLS_requested) &&
		// 	this._smtp_stage !== SMTPStages.ehlo
		// ) {
		// 	this.logger.debug(`Server requested to start a TLS connection: ${dataStr}`);

		// 	// send the start TLS command
		// 	if (!this._startTLS_requested) {
		// 		this._client?.write('STARTTLS\r\n');
		// 		this.logger.debug('sent: STARTTLS');
		// 		this._startTLS_requested = true;
		// 		return;
		// 	} else if (dataStr.toLowerCase().includes('220') && dataStr.toLowerCase().includes('start tls')) {
		// 		const success = await this.upgradeConnection(smtpHost, res);
		// 		this._startTLS_requested = false; // reset for future use
		// 		if (success) return; // Don't let it proceed further without TLS
		// 	} else {
		// 		this._startTLS_requested = false; // reset for future use
		// 	}
		// }

		// After EHLO, send MAIL FROM
		if (this._smtp_stage === SMTPStages.mailFrom) {
			// run mail from handler here
			const response = this.handleMailFrom(dataStr.trim());
			if (response && response.err === true) {
				// exit the code here
				await this.disconnect();
				res(true);
			}
		}

		// After MAIL FROM, send RCPT TO to test Catch All and the actual email
		if (this._smtp_stage === SMTPStages.rcptTo && !this._calculatedResult) {
			// run the rcpt to handle here
			await this.handleRcptTo(dataStr.trim(), smtpHost);

			if (
				this._email_verification_seq_index >= this._email_verification_seq.length - 1 &&
				!this._waiting_for_verification
			) {
				// complete
				await this.disconnect();
				res(true);
			}
		}
	}

	// handlers
	/**
	 * This function will handle the requests and responses to the EHLO stage
	 * @private
	 * @param {string} dataStr
	 * @returns {Promise<{err: boolean}>}
	 */
	async handleEHLO(dataStr) {
		let hasError = false;
		this.logger.debug(`Received: EHLO Block - ${dataStr}`);

		// When the server sends a 220 (Service ready) response, send EHLO
		if (dataStr.startsWith('220')) {
			const command = `EHLO ${this._ehlo}`;
			const fullCommand = `${command}\r\n`;
			// console.log(`📤 SENDING: ${command}`);
			// console.log(`🔍 SENDING BYTES: ${JSON.stringify(Buffer.from(fullCommand))}`);
			// this.logger.info(`📤 SENDING: ${command}`);
			this._client?.write(fullCommand); // Using \r\n instead of \r\r\n
		}

		// Check if server responds correctly (handle multi-line 250 responses)
		// Multi-line responses: 250-... 250-... 250 (final)
		const hasSuccess = dataStr.includes('250-') || dataStr.includes('250 ') || dataStr.startsWith('250');
		const isComplete = dataStr.includes('\r\n250 ') || (dataStr.startsWith('250 ') && !dataStr.includes('250-'));

		if (hasSuccess && isComplete) {
			console.log(`🔄 STAGE CHANGE: EHLO -> MAIL_FROM (multi-line response detected)`);
			this.logger.info(`🔄 STAGE CHANGE: EHLO -> MAIL_FROM`);
			this._smtp_stage = SMTPStages.mailFrom; // move to next stage
		} else if (hasSuccess) {
			// console.log(`🔍 EHLO partial success detected, waiting for complete response`);
		}

		// Fallback with HELO
		const dataStrLow = dataStr.toLowerCase();
		if (
			(dataStrLow.startsWith('500') || dataStrLow.startsWith('502')) &&
			dataStrLow.includes('command') &&
			dataStrLow.includes('recognized') &&
			!this._usedEhloFallback
		) {
			const command = `HELO ${this._ehlo}`;
			// console.log(`📤 SENDING (fallback): ${command}`);
			// this.logger.info(`📤 SENDING (fallback): ${command}`);
			this._client?.write(`${command}\r\n`); // Replace with your domain
			this._usedEhloFallback = true;
		} else {
			// handle error msgs if any
			const err = parseSMTPError(dataStr);

			// if there is an error at this stage -> mark the error for all the emails
			if (err) {
				if (err.message === smtpErrors.ErrBlocked || err.message === smtpErrors.ErrNotAllowed) {
					this.updateResults({ disabled: true, catch_all: false, done: true }); // we have been blocked by blacklist
				} else {
					this.updateResults({ error: true, errorMsg: err });
				}
				hasError = true; // mark as has error to terminate the code
			}

			// Edge case
			if (!dataStr.startsWith('220') && !dataStr.startsWith('250') && !err) {
				// Handle all other cases
				this.updateResults({
					error: true,
					errorMsg: { details: 'Invalid response from SMTP', message: 'Invalid response from SMTP' },
				});
				return { err: true };
			}
		}

		return { err: hasError };
	}

	/**
	 * This function will handle the requests and responses to the MAIL FROM stage
	 * @private
	 * @param {string} dataStr
	 * @returns {{err: boolean}}
	 */
	handleMailFrom(dataStr) {
		let hasError = false;
		this.logger.debug(`Received: MAIL FROM block - ${dataStr}`);

		// respond to the server with the proper response msg
		if (dataStr.startsWith('250')) {
			if (!this._waitingForFrom) {
				const command = `MAIL FROM:<${this.fromAddr}>`;
				// console.log(`📤 SENDING: ${command}`);
				// this.logger.info(`📤 SENDING: ${command}`);
				this._client?.write(`${command}\r\n`); // Replace with your email
				this._waitingForFrom = true;
			} else {
				console.log(`🔄 STAGE CHANGE: MAIL_FROM -> RCPT_TO`);
				this.logger.info(`🔄 STAGE CHANGE: MAIL_FROM -> RCPT_TO`);
				this._smtp_stage = SMTPStages.rcptTo;

				// set catch all to true by default for the next stage
				this.updateResults({ catch_all: true });
			}
		}

		// handle error msgs if any -> at this stage mark all the emails with the error
		const err = parseSMTPError(dataStr);
		if (err) {
			this.updateResults({ error: true, errorMsg: err });
			hasError = true;
		}

		// Edge case
		if (!dataStr.startsWith('250') && !err) {
			// Handle all other cases
			this.updateResults({
				error: true,
				errorMsg: { details: 'Invalid response from SMTP', message: 'Invalid response from SMTP' },
			});
			return { err: true };
		}

		return { err: hasError };
	}

	/**
	 * This function will handle the requests and responses to the RCPT TO stage
	 * @param {string} dataStr
	 * @param {string} smtpHost
	 * @private
	 */
	async handleRcptTo(dataStr, smtpHost = '') {
		this.logger.debug(`Received: RCPT block - ${dataStr}`);

		// get the email being processed currently -> if index is even, get the next odd
		let emailIndex =
				this._email_verification_seq_index % 2 === 0
					? this._email_verification_seq_index + 1
					: this._email_verification_seq_index,
			emailBeingProcessed = this._email_verification_seq[emailIndex];

		console.log(
			`📝 EMAIL PROCESSING: Index=${this._email_verification_seq_index}, EmailIndex=${emailIndex}, Email=${emailBeingProcessed}`
		);
		this.logger.info(
			`📝 EMAIL PROCESSING: Index=${this._email_verification_seq_index}, EmailIndex=${emailIndex}, Email=${emailBeingProcessed}`
		);

		const err = parseSMTPError(dataStr); // Legacy error parsing for compatibility
		const enhancedErr = parseSmtpErrorEnhanced(dataStr, 'RCPT_TO', emailBeingProcessed); // Enhanced error analysis
		const greylistAnalysis = analyzeGreylisting(dataStr, smtpHost); // Enhanced greylisting analysis
		const greylisted = greylistAnalysis.isGreylisted;

		// Enhanced greylisting handling with confidence scoring
		if (greylisted) {
			this.logger.debug(
				`Greylisting detected for ${emailBeingProcessed}: ${greylistAnalysis.reason} (confidence: ${greylistAnalysis.confidence}%)`
			);
			this.updateResultForEmail(
				{
					greylisted: true,
				},
				emailBeingProcessed
			);

			// For high confidence greylisting, consider marking for retry
			if (greylistAnalysis.confidence >= 75 && greylistAnalysis.shouldRetry) {
				this.updateResultForEmail(
					{
						requires_recheck: true,
					},
					emailBeingProcessed
				);
			}
		} else if (greylistAnalysis.confidence > 0 && greylistAnalysis.confidence < 50) {
			// Log uncertain cases for debugging
			this.logger.debug(
				`Uncertain greylisting for ${emailBeingProcessed}: ${greylistAnalysis.reason} (confidence: ${greylistAnalysis.confidence}%)`
			);
		}

		// Process errors first to ensure proper precedence over success responses
		if (err || enhancedErr) {
			// CRITICAL: Check for 5xx permanent failures (including 550 relay not permitted)
			const is5xxError = dataStr.match(/^5\d{2}/);
			const isRelayError =
				dataStr.toLowerCase().includes('relay not permitted') ||
				dataStr.toLowerCase().includes('relay denied') ||
				dataStr.toLowerCase().includes('relaying denied');

			// Track relay errors per domain
			if (isRelayError) {
				const { domain } = emailSplit(emailBeingProcessed);
				const relayInfo = this._relayBlockedDomains.get(domain) || { count: 0, lastAttempt: Date.now() };
				relayInfo.count++;
				relayInfo.lastAttempt = Date.now();
				this._relayBlockedDomains.set(domain, relayInfo);

				this.logger.warn(`Relay blocked for domain ${domain} (count: ${relayInfo.count})`);
			}

			// Handle errors with proper precedence - this runs before success handling
			if (this._waiting_for_verification && !this._calculatedResult) {
				// Enhanced error handling with context awareness
				const errorToHandle = enhancedErr || err;

				// Track retry count for this email
				const retryCount = this._emailRetryCount.get(emailBeingProcessed) || 0;

				// For 5xx errors (permanent failures), don't retry
				if (is5xxError) {
					this.logger.info(`Permanent 5xx error for ${emailBeingProcessed}: ${dataStr.trim()}`);

					// Mark as undeliverable for 5xx errors
					this.updateResultForEmail(
						{
							deliverable: false,
							catch_all: false,
							done: true,
							error: true,
							errorMsg: {
								message: isRelayError ? 'Relay not permitted' : 'Permanent failure',
								details: dataStr.trim(),
							},
						},
						emailBeingProcessed
					);

					// Don't retry 5xx errors
					this._emailRetryCount.set(emailBeingProcessed, this._maxRetriesPerEmail + 1);
				} else if (retryCount < this._maxRetriesPerEmail) {
					// For 4xx and other temporary errors, allow retry
					this._emailRetryCount.set(emailBeingProcessed, retryCount + 1);

					if (enhancedErr) {
						this.logger.debug(
							`Enhanced error analysis for ${emailBeingProcessed}: ${enhancedErr.errorType} (${enhancedErr.classification}, confidence: ${enhancedErr.confidence}%)`
						);

						// Handle enhanced error with context
						this.handleErrorsForEmail(
							enhancedErr.message,
							emailBeingProcessed,
							this._email_verification_seq_index === emailIndex
						);

						// Mark for retry based on analysis
						if (enhancedErr.shouldRetry && enhancedErr.confidence >= 70) {
							this.updateResultForEmail({ requires_recheck: true }, emailBeingProcessed);
						}
					} else if (err) {
						// Legacy error handling
						this.handleErrorsForEmail(
							err.message,
							emailBeingProcessed,
							this._email_verification_seq_index === emailIndex
						);

						if (
							err.details.toLowerCase().includes('protocol error') ||
							err.message.toLowerCase().includes('protocol error')
						) {
							this.updateResultForEmail({ requires_recheck: true }, emailBeingProcessed);
						}
					}
				} else {
					// Max retries exceeded
					this.logger.warn(`Max retries exceeded for ${emailBeingProcessed}`);
					this.updateResultForEmail(
						{
							deliverable: false,
							done: true,
							error: true,
							errorMsg: {
								message: 'Max retries exceeded',
								details: `Failed after ${this._maxRetriesPerEmail} attempts`,
							},
						},
						emailBeingProcessed
					);
				}
			} else if (!this._start_verification) {
				// Handle errors before verification starts
				this.handleErrorsForAll(err?.message || enhancedErr?.message || 'Unknown error');
			}

			// CRITICAL FIX: Always advance sequence after error handling
			if (this._waiting_for_verification && !this._calculatedResult) {
				console.log(`🔄 ERROR HANDLING: Advancing sequence after error for ${emailBeingProcessed}`);

				// For catch-all test failures (even index), only mark catch-all false if 5xx error
				if (this._email_verification_seq_index % 2 === 0 && is5xxError) {
					// This was a catch-all test (even index) with 5xx error
					this.updateResultForEmail({ catch_all: false }, emailBeingProcessed);
					console.log(
						`🔄 CATCH-ALL TEST FAILED with 5xx: ${emailBeingProcessed} - advancing to actual email`
					);
				}

				// Advance to next email in sequence
				this._email_verification_seq_index++;
				this._waiting_for_verification = false;

				// CRITICAL FIX: Immediately send next RCPT TO command after advancing sequence
				if (
					this._email_verification_seq_index < this._email_verification_seq.length &&
					!this._calculatedResult
				) {
					const nextEmail = this._email_verification_seq[this._email_verification_seq_index];

					// Circuit breaker: Skip remaining emails from relay-blocked domains
					const { domain: nextDomain } = emailSplit(nextEmail);
					const relayInfo = this._relayBlockedDomains.get(nextDomain);
					if (relayInfo && relayInfo.count >= 2) {
						this.logger.warn(`Skipping ${nextEmail} due to relay blocks on domain ${nextDomain}`);
						this.updateResultForEmail(
							{
								deliverable: false,
								done: true,
								error: true,
								errorMsg: {
									message: 'Domain relay blocked',
									details: 'Multiple relay failures for this domain',
								},
							},
							nextEmail
						);
						this._email_verification_seq_index++;
						// Recursively advance to next non-blocked email
						await this.handleRcptTo('250 Skipped', smtpHost);
						return;
					}

					const command = `RCPT TO:<${nextEmail}>`;
					// console.log(`📤 SENDING NEXT: ${command}`);
					// this.logger.info(`📤 SENDING NEXT: ${command}`);
					this._client?.write(`${command}\r\n`);
					this._waiting_for_verification = true;
				} else if (this._email_verification_seq_index >= this._email_verification_seq.length) {
					// If we've reached the end of the sequence, mark as complete
					this._calculatedResult = true;
					console.log(`🏁 SEQUENCE COMPLETE: No more emails to verify`);
				}
			}
		}

		// Handle success responses only if no errors were detected
		if ((dataStr.startsWith('250') || this._start_verification) && !err && !enhancedErr) {
			this._start_verification = true; // mark as true so future requests are handled here

			// check the verification status of the last email
			if (this._waiting_for_verification && !this._calculatedResult) {
				// mark deliverable true if no error for the email -> make sure its for the email and not for the catch-all email
				if (this._email_verification_seq_index === emailIndex) {
					const resultObj = this.smtpReports.get(emailBeingProcessed);
					if (!err) {
						this.updateResultForEmail(
							{ disabled: false, deliverable: true, greylisted: false, done: true },
							emailBeingProcessed
						);
					}
					// else if (
					// 	(err.message === smtpErrors.ErrBlocked || err.message === smtpErrors.ErrNotAllowed) &&
					// 	resultObj &&
					// 	!resultObj.catch_all_blocked
					// ) {
					// 	// this for the situation where the catchall random email was not blocked due to blacklist but a valid one is blocked
					// 	// -> This allows us to verify emails even though we are in blacklist (only works in some scenarios)
					// 	// -> disabled is marked as false, since although we are blacklisted, we were able to verify the email
					// 	this.updateResultForEmail(
					// 		{ disabled: false, deliverable: true, greylisted: false, done: true },
					// 		emailBeingProcessed
					// 	);
					// }
				}

				// increament to check the next email in the cycle
				if (this._email_verification_seq_index < this._email_verification_seq.length - 1) {
					// check if its a catch-all
					const { domain } = emailSplit(emailBeingProcessed);
					const resultObj = this.smtpReports.get(emailBeingProcessed);
					if (resultObj) {
						if (resultObj.catch_all) {
							// check if the email is still catch-all (catch-all is the default assumption, that is remove if an error is found for a random string)
							// update the result for the email
							this.updateResultForEmail({ catch_all: true, done: true }, emailBeingProcessed);

							// save the data for the domain to the cache with confidence scoring
							const confidence = resultObj.greylisted ? 75 : 95; // Lower confidence if greylisted
							await catchAllCache.cache(domain, true, confidence, 1);

							this._email_verification_seq_index += 2; // skipping the email since it is catch-all and we don't need to check again
						} else {
							// save the data for the domain to the cache with high confidence for non-catch-all
							const confidence = resultObj.greylisted ? 80 : 95; // Lower confidence if greylisted
							await catchAllCache.cache(domain, false, confidence, 1);

							this._email_verification_seq_index++;
						}
					}
				} else this._calculatedResult = true;

				// mark waiting for verification to be false
				this._waiting_for_verification = false;
			}

			// if index exceeds the length of array - 1, mark as complete
			if (this._email_verification_seq_index > this._email_verification_seq.length - 1) {
				this._calculatedResult = true;
				return;
			}

			/////////////////////////////////////////////////////////////////////////////////////////
			// check if the domain exists in cache -> if yes check for catchall and skip accordingly
			// -> check only when the catch-all random email is being checked in the email_verification_seq
			while (this._email_verification_seq_index % 2 === 0) {
				// 👆 while loop exists since, the next index it skips to may also be a catchall and hence cache needs to be checked
				// get the email being processed currently -> if index is even, get the next odd
				// ⚠️ This is not a duplicate code -> the indexes have been manipulated and need to be recalculated
				let emailIndex =
						this._email_verification_seq_index % 2 === 0
							? this._email_verification_seq_index + 1
							: this._email_verification_seq_index,
					emailBeingProcessed = this._email_verification_seq[emailIndex];

				// check for cache
				const { domain } = emailSplit(emailBeingProcessed);
				const res = await catchAllCache.check(domain);

				// ⚠️ if res === null, then the domain doesn't exist in cache -> do nothing in that case
				if (res === true) {
					// the email is a catch-all -> update the result for email and move the index
					this.updateResultForEmail({ catch_all: true, done: true }, emailBeingProcessed);
					this.logger.debug(
						`Log: Catch all from cache. Domain -> ${domain} emailBeingProcessed -> ${emailBeingProcessed} Email sequence index -> ${this._email_verification_seq_index}`
					);
					this._email_verification_seq_index += 2; // since we are skipping the legit email as well as it is a catch-all from cache
				} else if (res === false) {
					// the email is not catch-all -> can skip the catch-all check
					this.logger.debug(
						`Log: Not Catch all from cache. Domain -> ${domain} emailBeingProcessed -> ${emailBeingProcessed} Email sequence index -> ${this._email_verification_seq_index}`
					);
					this.updateResultForEmail({ catch_all: false }, emailBeingProcessed);
					this._email_verification_seq_index++; // skipping the catch-all check
				}

				// if index exceeds the length of array - 1, mark as complete
				if (this._email_verification_seq_index > this._email_verification_seq.length - 1) {
					this._calculatedResult = true;
					break;
				}

				if (res === null) break;
			}
			/////////////////////////////////////////////////////////////////////////////////////////

			// send email in the sequence to perform a verification check
			if (this._email_verification_seq_index < this._email_verification_seq.length && !this._calculatedResult) {
				// send email request
				const command = `RCPT TO:<${this._email_verification_seq[this._email_verification_seq_index]}>`;
				// console.log(`📤 SENDING: ${command}`);
				// this.logger.info(`📤 SENDING: ${command}`);
				this._client?.write(`${command}\r\n`); // send email for verification

				if (!this._waiting_for_verification) this._waiting_for_verification = true; // mark to true so we wait for verification next
			}
		}

		// Edge case - handle unexpected responses that are neither success nor recognized errors
		if (!dataStr.startsWith('250') && !err && !enhancedErr && !greylisted) {
			this.logger.warn(`Unexpected SMTP response: ${dataStr}`);
			// Handle all other cases
			this.updateResults({
				error: true,
				errorMsg: {
					details: 'Unexpected response from SMTP server',
					message: 'Unexpected response from SMTP server',
				},
			});
		}
	}

	/**
	 * Handle SMTP errors for all the emails
	 * @param {string} errMsg
	 * @private
	 */
	handleErrorsForAll(errMsg) {
		switch (errMsg) {
			case smtpErrors.ErrFullInbox: {
				// This can only be triggered if the catch_all is false and if triggered for rand email, then catch-all true is correct
				this.updateResults({ full_inbox: true, done: true });
				break;
			}
			case smtpErrors.ErrNotAllowed: {
				this.updateResults({ disabled: true, catch_all: false, done: true }); // since disabled doesn't necessarily means catch-all
				break;
			}
			case smtpErrors.ErrServerUnavailable: {
				this.updateResults({ catch_all: false, deliverable: false, done: true });
				break;
			}
			case smtpErrors.ErrBlocked: {
				// The SMTP server could also be blocked
				this.updateResults({ disabled: true, catch_all: false, done: true });
				break;
			}
			default: {
				this.updateResults({ catch_all: false, done: true });
			}
		}
	}

	/**
	 * Handle SMTP errors for aa single email
	 * @param {string} errMsg
	 * @param {string} email
	 * @param {boolean} not_catchall_email
	 * @private
	 */
	handleErrorsForEmail(errMsg, email, not_catchall_email) {
		switch (errMsg) {
			case smtpErrors.ErrFullInbox: {
				// This can only be triggered if the catch_all is false and if triggered for rand email, then catch-all true is correct
				this.updateResultForEmail({ full_inbox: true, done: true }, email);
				break;
			}
			case smtpErrors.ErrNotAllowed: {
				// since disabled doesn't necessarily means catch-all
				this.updateResultForEmail({ disabled: true, catch_all: false, done: true }, email);
				break;
			}
			case smtpErrors.ErrServerUnavailable: {
				this.updateResultForEmail({ catch_all: false, deliverable: false, done: true }, email);
				break;
			}
			case smtpErrors.ErrBlocked: {
				// The SMTP server could also be blocked
				if (!not_catchall_email)
					this.updateResultForEmail(
						{
							disabled: true,
							catch_all: false,
							catch_all_blocked: true,
							done: true,
						},
						email
					);
				else
					this.updateResultForEmail(
						{
							disabled: true,
							catch_all: false,
							done: true,
						},
						email
					);

				break;
			}
			default: {
				this.updateResultForEmail({ catch_all: false, done: true }, email);
			}
		}
	}

	/** Apply change to all result objs
	 * @param {any} obj
	 * @param {boolean} include_done
	 * @private
	 */
	updateResults(obj, include_done = true) {
		for (const email of this._emailsToVerify) {
			const new_report_obj = this.smtpReports.get(email);
			if (new_report_obj && (include_done || !new_report_obj.done))
				this.smtpReports.set(email, {
					...new_report_obj,
					...obj,
				});
		}
	}

	/** Apply change to the result obj of a single email
	 * @param {any} obj
	 * @param {string} email
	 * @private
	 */
	updateResultForEmail(obj, email) {
		const new_report_obj = this.smtpReports.get(email);
		if (new_report_obj)
			this.smtpReports.set(email, {
				...new_report_obj,
				...obj,
			});
	}

	/**
	 * This function will reset the class before starting a new verification
	 * @private
	 * @param {boolean} hardReset - resets everything to exactly if the class was first initialized
	 */
	reset(hardReset = false) {
		this._client = new net.Socket();
		// this._secureClient = undefined;

		this._reconnections = 0;
		this._self_disconnect = false;

		// Reset response buffering
		this._responseBuffer = [];
		this._processingMultiLine = false;
		if (this._responseTimer) {
			clearTimeout(this._responseTimer);
			this._responseTimer = null;
		}

		// Reset unified timer state
		this.clearAllTimers();
		this._timerState = {
			socketTimer: null,
			inactivityTimer: null,
			lastActivity: 0,
			expectingResponse: false,
			currentStage: 'idle',
		};

		this.resetForReconnection();

		if (hardReset) {
			this.smtpReports = new Map();
			this._emailsToVerify = [];
			this._email_verification_seq = [];
			this._email_verification_seq_index = 0;
			this._emailStates = new Map();
			this._verificationQueue = [];
			this._currentJobIndex = 0;
			this._currentJob = null;
			this._clientConnected = false;
			this._emailRetryCount = new Map();
			this._relayBlockedDomains = new Map();
		}
	}

	/**
	 * Simplified reset for reconnection with state validation
	 * @private
	 */
	resetForReconnection() {
		// Reset SMTP protocol state
		this._usedEhloFallback = false;
		this._waitingForFrom = false;
		this._start_verification = false;
		this._waiting_for_verification = false;
		this._calculatedResult = false;
		this._smtp_stage = SMTPStages.ehlo;

		// Reset connection state tracking
		this._startTLS_requested = false;
		this._tls_connection_active = false;

		// Simplified sequence index handling - reset to start of current verification cycle
		if (this._verificationQueue.length > 0 && this._currentJobIndex < this._verificationQueue.length) {
			// Reset current job phase to allow retesting
			const currentJob = this._verificationQueue[this._currentJobIndex];
			if (currentJob && currentJob.phase !== this.EmailVerificationPhase.COMPLETED) {
				currentJob.phase = this.EmailVerificationPhase.PENDING;
				currentJob.attempts = (currentJob.attempts || 0) + 1;
				currentJob.currentTestEmail = currentJob.randomEmail; // Restart with catch-all test
				this.logger.debug(
					`Reset job for ${currentJob.email} to phase: ${currentJob.phase} (attempt: ${currentJob.attempts})`
				);
			}
		}

		// Legacy sequence index alignment for backward compatibility
		// Ensure we start at an even index (catch-all email position)
		this._email_verification_seq_index = Math.max(
			0,
			this._email_verification_seq_index % 2 === 0
				? this._email_verification_seq_index
				: this._email_verification_seq_index - 1
		);

		// Reset timer state for new connection
		this.clearAllTimers();
		this._timerState.currentStage = 'reconnection';
		this._timerState.expectingResponse = false;
	}

	/** This function will reconnect to the client
	 * - If max retries are exceeded the function will return false and prompt to quit
	 * @private
	 * @param {string} smtpHost
	 * @param {boolean} skipIncreament - whether to count this as a increament in reconnection (in this case skip)
	 */
	async reconnect(smtpHost, skipIncreament = false) {
		let success = false;
		try {
			this.logger.debug('Checking reconnection requirements...');

			await new Promise(res => {
				// reconnect only if it was not a self disconnect AND if there is no TLS connection
				// if (!this._self_disconnect && !this._secureClient) {
				if (!this._self_disconnect) {
					// connect the client to the SMTP server
					if (this._reconnections < this._max_reconnections) {
						if (!skipIncreament) this._reconnections++;

						this.logger.error(`About to reconnect now! Port: ${this._smtp_port} Host: ${smtpHost}`);
						// create new net client since the net client is later replaced by the TLS client
						this._client.connect(this._smtp_port, smtpHost, () => {
							this.logger.debug(`Reconnected to SMTP server ${smtpHost}`);
							this._clientConnected = true;
							success = true; // mark connection success

							// proceed to do the EHLO and FROM commands
							this.resetForReconnection();

							res(true);
						});
					} else res(false);
				} else res(false);
			});
		} catch (error) {
			this.logger.error(`reconnect() error -> ${error?.toString}`);
		} finally {
			this.logger.error('Exited reconnection');
			return success;
		}
	}

	/** Returns the from address */
	get fromAddr() {
		return `contact@${this._fromDomain}`;
	}

	/** Generate & return random email
	 * @private
	 * @param {string} domain
	 */
	randEmail(domain) {
		let randStr = uuidv4().replace(/-/g, '');
		randStr = randStr.substring(0, Math.round(randStr.length / 2));
		return `${randStr}@${domain}`;
	}

	/**
	 * Generate honey probe addresses for catch-all detection
	 * @param {string} domain
	 * @returns {string[]} - 3 unique random emails that definitely don't exist
	 */
	static generateHoneyProbes(domain) {
		return [0, 1, 2].map(() => {
			const hex = uuidv4().replace(/-/g, '').substring(0, 8);
			return `${hex}@${domain}`;
		});
	}

	/**
	 * Function to initiate disconnection from the client
	 * @private
	 * @param {boolean} ignoreTLS
	 */
	async disconnect(ignoreTLS = false) {
		try {
			const command = 'QUIT';
			// console.log(`📤 SENDING: ${command}`);
			// this.logger.info(`📤 SENDING: ${command}`);
			if (this._client) this._client?.write(`${command}\r\n`); // initiate the client disconnection + wait after it
			// if (this._secureClient) this._secureClient?.write('QUIT\r\n'); // initiate the client disconnection + wait after it
			this._self_disconnect = true; // Marks that the disconnection was initiated by us

			// wait for sometime to check if the client disconnected | if the client already disconnected
			let startTime = new Date().getTime();
			while (true) {
				const now = new Date().getTime(),
					diff = now - startTime;

				if (!this._clientConnected) break;

				if (diff > this._timeout - 500) {
					// 500 ms before timeout
					this.logger.debug(`FORCE QUITING CONNECTION!`);
					break; // times up!
				}

				await promiseAwaitMs(100); // check every .1 seconds
			}

			if (this._clientConnected) {
				// this._secureClient?.end();
				this._client?.end();
				// close yourself
				// this._secureClient?.destroy();
				this._client?.destroy();
			}
		} catch (error) {
			console.error(`An error has occurred while disconnecting from the client. Error -> `, error);
		}
	}

	/**
	 * Unified timer management to handle both socket and inactivity timeouts
	 * @private
	 * @param {string} stage - Current SMTP stage for context-aware timing
	 * @param {boolean} expectingResponse - Whether we're expecting a server response
	 */
	resetTimers(stage = 'unknown', expectingResponse = false) {
		// Clear existing timers
		this.clearAllTimers();

		// Update timer state
		this._timerState.lastActivity = Date.now();
		this._timerState.expectingResponse = expectingResponse;
		this._timerState.currentStage = stage;

		// Set socket timeout with context-aware duration
		const timeoutDuration = this.getTimeoutForStage(stage);

		if (this._secureClient) {
			this._secureClient.setTimeout(timeoutDuration);
		} else if (this._client) {
			this._client.setTimeout(timeoutDuration);
		}

		// Set inactivity timer with longer duration for expected responses
		const inactivityDuration = expectingResponse ? timeoutDuration * 1.5 : timeoutDuration;
		this._timerState.inactivityTimer = setTimeout(() => {
			this.logger.warn(`Inactivity timeout in stage: ${stage} (expecting response: ${expectingResponse})`);
			this.handleTimeout(stage, 'inactivity');
		}, inactivityDuration);

		this.logger.debug(
			`Timers reset for stage: ${stage}, timeout: ${timeoutDuration}ms, expecting response: ${expectingResponse}`
		);
	}

	/**
	 * Get appropriate timeout duration based on SMTP stage
	 * @private
	 * @param {string} stage
	 * @returns {number}
	 */
	getTimeoutForStage(stage) {
		/** @type {Record<string, number>} */
		const stageTimeouts = {
			EHLO: this._timeout,
			MAIL_FROM: this._timeout,
			RCPT_TO: this._timeout * 1.2, // Slightly longer for email verification
			DATA: this._timeout * 0.8, // Shorter for simple commands
			QUIT: this._timeout * 0.5, // Quick disconnection
			unknown: this._timeout,
			idle: this._timeout,
		};

		return stageTimeouts[stage] || this._timeout;
	}

	/**
	 * Clear all active timers
	 * @private
	 */
	clearAllTimers() {
		if (this._timerState.socketTimer) {
			clearTimeout(this._timerState.socketTimer);
			this._timerState.socketTimer = null;
		}

		if (this._timerState.inactivityTimer) {
			clearTimeout(this._timerState.inactivityTimer);
			this._timerState.inactivityTimer = null;
		}
	}

	/**
	 * Handle timeout events with proper context
	 * @private
	 * @param {string} stage
	 * @param {'socket'|'inactivity'} timeoutType
	 */
	handleTimeout(stage, timeoutType) {
		this.logger.warn(`${timeoutType} timeout in stage: ${stage}. No activity detected for ${this._timeout}ms`);

		// Update results with timeout error
		this.updateResults(
			{
				error: true,
				errorMsg: {
					message: smtpErrors.ErrTimeout,
					details: `${timeoutType} timeout in ${stage} stage. No activity detected for ${this._timeout}ms`,
				},
			},
			false
		);

		// Initiate disconnection
		this._self_disconnect = true;
		if (this._secureClient) {
			this._secureClient.end();
			this._secureClient.destroy();
		} else if (this._client) {
			this._client.end();
			this._client.destroy();
		}
	}

	/**
	 * Legacy method for backward compatibility
	 * @deprecated Use resetTimers() instead
	 */
	resetInactivityTimer() {
		this.resetTimers(this._timerState.currentStage, this._timerState.expectingResponse);
	}
}

module.exports = SMTPVerificationSC;
