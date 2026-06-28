const winston = require('winston');
const { loggerTypes } = require('../logging/logger');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const promiseAwait = require('../utils/promiseAwait');
const queue = require('../staging/queue');
const stateVariables = require('../../data/stateVariables');
const sqlAsync = require('../../database/sqlAsync');
const antiGreylisting = require('./antiGreylisting');
const { axiosGet, axiosPost } = require('../utils/axios');
const { updateVerificationResults, saveValidEmails } = require('../route_fns/verify/verificationDB');
const StartupRecovery = require('../recovery/startupRecovery');
const startupCoordination = require('../recovery/startupCoordination');
const categoryFromEmailData = require('./utils/categoryFromEmailData');

/**
 * @typedef {Object} RequestObj
 * @property {string} request_id
 * @property {string[]} emails
 * @property {string} response_url
 */

/**
 * @typedef {Object} VerificationObj
 * @property {string} email
 * @property {"yes" | "no" | "unknown"} reachable
 * @property {{username: string, domain: string, valid: boolean}} syntax
 * @property {{host_exists: boolean, full_inbox: boolean, catch_all: boolean, deliverable: boolean, disabled: boolean}} smtp
 * @property {any} gravatar
 * @property {string} suggestion
 * @property {boolean} disposable
 * @property {boolean} role_account
 * @property {boolean} free
 * @property {boolean} has_mx_records
 * @property {{Host: string, Pref: number}[]} mx
 * @property {boolean} error
 * @property {string} error_msg
 */

// Restart worker time
const restart_after = 10 * 60 * 1000; // 10 mins (not in the middle of a process)

/**
 * This is the controller to the verifier instances.
 * - The controller assigns requests to be processed by verifier instances
 * - The controller pulls requests from the queue when there is an empty slot
 * - The controller also saves its state to the DB
 */
class Controller {
	/** @private @type {string} - controller ID*/
	controllerID;
	/** @private @type {Worker[]} - array of available worker instances */
	workers;
	/** @private @type {number[]} - last ping time from a worker */
	workers_last_ping;
	/** @private @type {(RequestObj | null)[]} - request assignments to workers */
	request_assignments;
	/** @public @type {Map<string, RequestObj & {result: Map<string, VerificationObj>, created_at: number}>} request archive - public for recovery module access */
	request_archive = new Map();

	/** @private @type {number} - Number of threads to create */
	threads_num = stateVariables.thread_num;
	/** @private @type {number} - ping check frequency*/
	ping_check_freq = stateVariables.ping_freq;
	/** @private @type {string} - verifier instance path */
	verifierInstancePath = `./functions/verifier/verifierInstance.js`;
	/** @private Logger */
	logger = winston.loggers.get(loggerTypes.verifier);

	/**  Map of worker and restart after time @private @type {Map<number, number>} */
	worker_restart_at = new Map();

	/** @private @type {Map<number, boolean>} - tracks if worker is being restarted */
	worker_restarting = new Map();

	/** @private @type {Map<number, boolean>} - tracks if worker is locked for assignment */
	worker_assignment_lock = new Map();

	/**
	 * @param {string} controllerID
	 */
	constructor(controllerID) {
		this.controllerID = controllerID;
		this.workers = [];
		this.workers_last_ping = [];
		this.request_assignments = [];

		this.init();
	}

	/** initialize the workers */
	async init() {
		try {
			// Initialize the table in the database
			await sqlAsync.runAsync(`CREATE TABLE IF NOT EXISTS ${this.controllerID} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
				workerIndex TEXT NOT NULL UNIQUE,
                request TEXT NOT NULL,
				created_at NUMBER NOT NULL
                )`);

			// intialize the archive table in the database if not already exists
			await sqlAsync.runAsync(`CREATE TABLE IF NOT EXISTS ${this.controllerID}Archive (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
				request_id TEXT NOT NULL UNIQUE,
				emails TEXT NOT NULL,
				result TEXT NOT NULL,
				response_url TEXT NOT NULL,
				created_at NUMBER NOT NULL
                )`);

			// initialize the results tracking table (replaces PostgreSQL minion_assign table)
			await sqlAsync.runAsync(`CREATE TABLE IF NOT EXISTS ${this.controllerID}Results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
				request_id TEXT NOT NULL UNIQUE,
				status TEXT CHECK(status IN ('queued', 'processing', 'completed', 'failed')) DEFAULT 'queued',
				verifying BOOLEAN DEFAULT 0,
				greylist_found BOOLEAN DEFAULT 0,
				greylist_found_at TEXT,
				blacklist_found BOOLEAN DEFAULT 0,
				blacklist_found_at TEXT,
				results TEXT,
				total_emails INTEGER DEFAULT 0,
				completed_emails INTEGER DEFAULT 0,
				webhook_sent BOOLEAN DEFAULT 0,
				webhook_attempts INTEGER DEFAULT 0,
				created_at NUMBER NOT NULL,
				updated_at NUMBER NOT NULL,
				completed_at NUMBER
                )`);

			// restore archive from database to memory
			await this.syncArchive();

			// run startup recovery to detect and recover orphaned requests
			let recoverySucceeded = false;
			try {
				this.logger.info('========================================');
				this.logger.info('    STARTUP RECOVERY INITIATED');
				this.logger.info('========================================');

				const recovery = new StartupRecovery();
				const recoveryStats = await recovery.runRecovery(this, antiGreylisting);

				this.logger.info('========================================');
				this.logger.info('    RECOVERY COMPLETED SUCCESSFULLY ✓');
				this.logger.info('========================================');
				this.logger.info(`Archives Restored: ${recoveryStats.archivesRestored}`);
				this.logger.info(`Orphans Found: ${recoveryStats.orphansFound}`);
				this.logger.info(`  - Completed: ${recoveryStats.orphansCompleted}`);
				this.logger.info(`  - Re-queued: ${recoveryStats.orphansRequeued}`);
				this.logger.info(`  - Waiting Greylist: ${recoveryStats.orphansWaitingGreylist}`);
				this.logger.info(`  - Failed: ${recoveryStats.orphansFailed}`);
				this.logger.info(`Errors: ${recoveryStats.errorsEncountered}`);
				if (recoveryStats.recoveredRequestIds.length > 0) {
					this.logger.info(`Recovered IDs: ${recoveryStats.recoveredRequestIds.join(', ')}`);
				}
				this.logger.info('========================================');

				recoverySucceeded = true;
			} catch (recoveryError) {
				this.logger.error('========================================');
				this.logger.error('    RECOVERY FAILED ✗');
				this.logger.error('========================================');
				this.logger.error(`Error: ${recoveryError?.toString()}`);
				this.logger.error(`Stack: ${recoveryError?.stack}`);
				this.logger.error('========================================');
				this.logger.warn('System will continue startup with degraded state');
				this.logger.warn('Some orphaned requests may not be recovered');
				// Decision: Continue startup with degraded state (recovery failed but system can operate)
			} finally {
				// CRITICAL: Always signal complete, even on error, to prevent deadlock
				startupCoordination.markRecoveryComplete();
				this.logger.info(
					`Recovery phase complete [${
						recoverySucceeded ? 'SUCCESS' : 'FAILED'
					}] - releasing queue/antiGreylisting`
				);
			}

			// create the verifier worker instances
			for (let i = 0; i < this.threads_num; i++) {
				const workerInstance = new Worker(path.join(process.cwd(), this.verifierInstancePath), {
					workerData: { index: i },
				});
				this.workers.push(workerInstance); // Add to the list of workers
				this.workers_last_ping.push(new Date().getTime()); // Add the last time we know the worker exists
				this.request_assignments.push(null); // empty requests assigned

				// function to handle events on the worker -> worker stopping to work + exiting + messages and so on
				this.handleEvents(workerInstance, i);
				this.worker_restart_at.set(i, new Date().getTime() + restart_after); // restart after time given
				this.worker_restarting.set(i, false);
				this.worker_assignment_lock.set(i, false);
			}

			// start the monitoring
			// this.monitor(); // turning off monitor since the restarting is done via event listeners

			// pull sync from the database -> if there are incomplete tasks assign them to the workers
			await this.syncDB();

			// start checking
			this.checkQueue();

			// start periodic archive cleanup (runs every hour)
			this.purgeArchiveRec();

			// start disposable domains list updater (runs every 3 days)
			this.updateDisposableListRec();
		} catch (error) {
			this.logger.error(`init() error -> ${error?.toString()}`);
		}
	}

	/** monitor health of workers
	 * - each worker thread should ping the parent every 10 seconds
	 * - in lieu of a ping the parent will restart the worker
	 * @private
	 */
	async monitor() {
		let buffer = 2.5; // 2.5 seconds of additional time to account for I/O block delays

		try {
			// get the current time
			const curr_time = new Date().getTime();

			// loop over each of the workers and check if they are active
			for (let i = 0; i < this.workers_last_ping.length; i++) {
				const time = this.workers_last_ping[i];
				if (Math.abs(curr_time - time) < this.ping_check_freq * 1000 * buffer) continue; // evreything is fine and the worker is reporting as usual + buffer

				// The worker is not working as normal and needs to be restarted
				await this.restartWorker(i);
			}
		} catch (error) {
			this.logger.error(`monitor() error -> ${error?.toString()}`);
		} finally {
			// wait for delay
			await promiseAwait(this.ping_check_freq + buffer);

			// run the check again
			this.monitor();
		}
	}

	/**
	 * Check if the queue has entries that can be sent to a worker
	 * @private
	 */
	async checkQueue() {
		let delay = 1; // check again in 1 sec
		try {
			// restart the workers if they are free and it is time to restart
			for (let i = 0; i < this.threads_num; i++) {
				// check if there is any request running or worker is being restarted
				const request = this.request_assignments[i];
				if (request || this.worker_restarting.get(i) || this.worker_assignment_lock.get(i)) continue;

				// restart the worker otherwise
				if ((this.worker_restart_at.get(i) || Infinity) < new Date().getTime()) {
					// Lock the worker to prevent assignments during restart
					this.worker_assignment_lock.set(i, true);
					this.worker_restarting.set(i, true);

					// restart the worker here
					await this.restartWorker(i);

					// set new time to restart the worker
					this.worker_restart_at.set(i, new Date().getTime() + restart_after);
				}
			}

			// check if there are any anti grey list entries -> if yes assign them
			await this.checkAntiGreylist();

			// check if any of the worker is free and has no assignment -> get the number of workers that are free
			let slotsLeft = this.request_assignments.reduce((f, c) => (!c ? f + 1 : f), 0);

			for (let i = 0; i < this.request_assignments.length; i++) {
				if (slotsLeft <= 0) break; // if no slots left, then no more checking

				const request = this.request_assignments[i];

				// Skip if worker has a request, is restarting, or is locked
				if (request || this.worker_restarting.get(i) || this.worker_assignment_lock.get(i)) continue;

				// get a latest request from the queue
				if (queue.isEmpty) break; // <- the queue is empty and we can exit the loop
				const currReq = queue.current;

				// Lock the worker during assignment
				this.worker_assignment_lock.set(i, true);

				// assign the request to the worker
				const success = await this.assign(i, currReq);

				if (success) {
					// move to the next item in the queue
					await queue.done(currReq.request_id);

					// mark the request as verifying in the database
					await this.markAsVerifying(currReq.request_id);

					// reduce the slots left
					slotsLeft--;
				}

				// Unlock the worker after assignment attempt
				this.worker_assignment_lock.set(i, false);
			}
		} catch (error) {
			this.logger.error(`checkQueue() error -> ${error?.toString()}`);
		} finally {
			// wait for delay
			await promiseAwait(delay);

			this.checkQueue(); // check again
		}
	}

	/**
	 * Check if antiGreylisting has any entry that can be sent to a worker
	 * @private
	 */
	async checkAntiGreylist() {
		try {
			// get the list of entries to test for greyist
			const requests = await antiGreylisting.tryGreylisted();

			const requestLen = requests.length;
			if (requestLen === 0) return;

			this.logger.debug(`Attempting to retry greylisted emails...`);
			let slotsLeft = this.request_assignments.reduce((f, c) => (!c ? f + 1 : f), 0),
				request_index = 0;
			for (let i = 0; i < this.request_assignments.length; i++) {
				if (slotsLeft <= 0) break; // if no slots left, then no more checking

				const request = this.request_assignments[i]; // check if there are running requests
				// Skip if worker has a request, is restarting, or is locked
				if (request || this.worker_restarting.get(i) || this.worker_assignment_lock.get(i)) continue;

				// get a latest request from the greylist
				if (request_index >= requestLen) break; // <- the requests list is empty and we can exit the loop
				const currReq = requests[request_index];

				// Lock the worker during assignment
				this.worker_assignment_lock.set(i, true);

				// assign the request to the worker
				const success = await this.assign(i, currReq);
				this.logger.debug(`Attempt on greylisted emails for ${currReq.request_id}`);

				if (success) {
					// move to the next item in the list
					request_index++;

					// reduce the slots left
					slotsLeft--;
				}

				// Unlock the worker after assignment attempt
				this.worker_assignment_lock.set(i, false);
			}
		} catch (error) {
			this.logger.error(`checkAntiGreylist() error -> ${error?.toString()}`);
		}
	}

	/**
	 * handle events on workers
	 * @private
	 * @param {Worker} worker
	 * @param {number} workerIndex
	 */
	handleEvents(worker, workerIndex) {
		try {
			// Listen for messages from the worker
			worker.on('message', msg => {
				// -> code to handle the messages from the worker <-
				// if a request is complete, update the objects of the class
				const type = msg?.type || '';

				// check if ping
				switch (type) {
					case 'ping': {
						this.ping(workerIndex);
						break;
					}
					case 'complete': {
						// handle the complete and setup for anti greylisting
						this.handlePartialComplete(
							workerIndex,
							msg?.request_id || '',
							msg?.result || new Map(),
							msg?.greylisted_emails || [],
							msg?.blacklisted_emails || [],
							msg?.recheck_required || []
						);
						break;
					}
					default: {
						//
					}
				}
			});

			// Handle any errors that occur in the worker
			worker.on('error', async err => {
				// restart the worker with the same request
				await this.restartWorker(workerIndex);
			});

			// Handle the event when the worker exits
			worker.on('exit', async code => {
				// restart the worker with the same request
				await this.restartWorker(workerIndex);
			});
		} catch (error) {
			this.logger.error(`handleEvents() error -> ${error?.toString()}`);
		}
	}

	/**
	 * handle request completion
	 * @private
	 * @param {number} workerIndex
	 * @param {string} request_id
	 * @param {Map<string, VerificationObj>} result
	 * @param {string[]} greylisted_emails
	 * @param {string[]} blacklisted_emails
	 * @param {string[]} recheck_required
	 */
	async handlePartialComplete(
		workerIndex,
		request_id,
		result,
		greylisted_emails,
		blacklisted_emails,
		recheck_required
	) {
		this.logger.debug(
			`Received from worker results for request id -> ${request_id} Proceed status: ${
				this.request_assignments[workerIndex]?.request_id === request_id
			}`
		);

		// verify that the request_id matches with the request_id that was provided.
		if (this.request_assignments[workerIndex]?.request_id === request_id) {
			const requestObj = this.request_assignments[workerIndex];

			if (!requestObj) return;

			this.logger.debug(
				`Partial results for ${request_id}: ` +
					`greylisted=${greylisted_emails.length}, ` +
					`blacklisted=${blacklisted_emails.length}, ` +
					`recheck=${recheck_required.length}`
			);

			// incase greylisted and blacklisted emails are found, track them in database
			if (
				(Array.isArray(greylisted_emails) && greylisted_emails.length > 0) ||
				(Array.isArray(blacklisted_emails) && blacklisted_emails.length > 0) ||
				(Array.isArray(recheck_required) && recheck_required.length > 0)
			) {
				if (greylisted_emails.length > 0) {
					this.logger.debug(`Greylisted emails found for request ${request_id}`);
					// mark that the request has greylisted emails
					await this.markGreylisted(request_id);
				}
				if (blacklisted_emails.length > 0) {
					this.logger.debug(`Blacklisted emails found for request ${request_id}`);
					// mark that the request has blacklisted emails
					await this.markBlacklisted(request_id);
				}
			}

			if (
				greylisted_emails.length > 0 &&
				((await antiGreylisting.checkGreylist(request_id)) || !(await antiGreylisting.exists(request_id)))
			) {
				this.logger.debug(`Greylisted emails found for request id -> ${request_id}`);

				// add to anti greylisting
				await antiGreylisting.add(request_id, greylisted_emails, requestObj.response_url);

				// Add the request to the archive
				if (this.request_archive.get(request_id)) {
					const archObj = this.request_archive.get(request_id),
						resultOld = archObj?.result;

					if (resultOld) {
						// CRITICAL: resultOld first, result second → new results overwrite old results
						this.request_archive.set(request_id, {
							...archObj,
							result: new Map([...resultOld, ...result]),
						});
						await this.pushArchive(request_id, {
							...archObj,
							result: new Map([...resultOld, ...result]),
						});
					}
				} else {
					this.request_archive.set(request_id, {
						...requestObj,
						result: result,
						created_at: new Date().getTime(),
					});
					await this.pushArchive(request_id, {
						...requestObj,
						result: result,
						created_at: new Date().getTime(),
					});
				}
			} else {
				this.logger.debug(`No greylisted emails found for request ${request_id}! Proceeding to inform user.`);
				// clear all greylist saves for the request
				antiGreylisting.clearGreylistForRequest(request_id);

				// check if there are results in the archive
				const requestFromArch = this.request_archive.get(request_id);

				let finalResult = result;
				if (requestFromArch) {
					const archivedResult = requestFromArch.result;
					finalResult = new Map([...archivedResult, ...result]); // new results will overlap archived entries
				}

				const resultArr = Array.from(finalResult.values()),
					resultLen = resultArr?.length || 0;

				// mark the request as completed in the controller database (controller0Results)
				await this.updateResultsDB(request_id, {
					status: 'completed',
					results: JSON.stringify(resultArr),
					total_emails: resultLen,
					completed_emails: resultLen,
					completed_at: new Date().getTime(),
				});

				this.logger.debug(`Request ${request_id} marked as completed in controller database`);

				// ALSO update the verification_requests table for frontend access
				try {
					const transformedResults = this.transformResultsForAPI(resultArr);
					await updateVerificationResults(request_id, transformedResults);
					this.logger.debug(`Request ${request_id} synced to verification_requests table`);

					// Derive source type from request_id prefix (single-*, csv-*, api-*)
					const source = request_id.startsWith('csv-') ? 'csv' : request_id.startsWith('api-') ? 'api' : 'single';
					saveValidEmails(transformedResults, source);
				} catch (error) {
					this.logger.error(`Failed to sync results to verification_requests: ${error?.toString()}`);
				}

				// send the request to the client via webhook callback if response_url is provided
				const response_url = this.request_assignments[workerIndex]?.response_url;
				if (response_url) {
					this.logger.debug(`Sending callback for request ${request_id} to ${response_url}`);
					await this.sendResultsCallback(request_id, response_url, resultArr, resultLen);
				} else {
					this.logger.debug(`No response_url provided for request ${request_id}, results stored in database`);
				}

				// cleanup archive after completion (immediate memory cleanup)
				if (this.request_archive.has(request_id)) {
					this.request_archive.delete(request_id);
					this.logger.debug(`Deleted archive from memory for completed request ${request_id}`);
				}

				// cleanup archive from database (will be handled by tiered cleanup job)
				// Note: Not deleting immediately to allow webhook retry verification window
			}

			// }

			// terminate the request
			this.request_assignments[workerIndex] = null;
			// update the database
			this.pushDB(workerIndex, null);
		}
	}

	/** This function will restart a worker and assign the worker the same task it was running
	 * @private
	 * @param {number} workerIndex
	 */
	async restartWorker(workerIndex) {
		let success = false;
		try {
			this.workers[workerIndex].removeAllListeners(); // remove all listeners

			const worker = this.workers[workerIndex];

			if (!worker) {
				throw new Error(`Worker at index ${workerIndex} not found!`);
			}

			// remove all listeners for worker
			worker.removeAllListeners();
			// terminate the worker
			worker.terminate();

			// start the worker again
			const workerInstance = new Worker(path.join(process.cwd(), this.verifierInstancePath), {
				workerData: { index: workerIndex },
			});
			this.workers[workerIndex] = workerInstance; // Replace in the list of workers
			this.workers_last_ping[workerIndex] = new Date().getTime(); // Replace last time we know the worker exists
			this.logger.info(`Worker at index ${workerIndex} has been restarted!`);

			// function to handle events on the worker -> worker stopping to work + exiting + messages and so on
			this.handleEvents(workerInstance, workerIndex); // add listeners again

			// send the worker its assigned task again
			const request = this.request_assignments[workerIndex];
			if (request) await this.assign(workerIndex, request, true);

			success = true;
		} catch (error) {
			this.logger.error(`restartWorker() error -> ${error?.toString()}`);
		} finally {
			// Clear the restart flags
			this.worker_restarting.set(workerIndex, false);
			this.worker_assignment_lock.set(workerIndex, false);
			return success;
		}
	}

	/** Assign given request to the worker
	 * @private
	 * @param {number} workerIndex
	 * @param {RequestObj} request
	 * @param {boolean} reassign - whether to reassign the worker
	 */
	async assign(workerIndex, request, reassign = false) {
		let success = false;
		try {
			// check if the worker is available to take accept this request
			if (this.request_assignments[workerIndex] && !reassign) return false; // worker is not free

			// assign the request to the worker
			this.workers[workerIndex].postMessage({ ...request, type: 'request' });

			// save assignment to the request_assignment list
			if (!reassign) this.request_assignments[workerIndex] = request;

			// save the assignment to the database
			await this.pushDB(workerIndex, request);

			success = true;
		} catch (error) {
			this.logger.error(`assign() error -> ${error?.toString()}`);
		} finally {
			return success;
		}
	}

	/**
	 * Update request status and details in local SQLite database (replaces PostgreSQL operations)
	 * @param {string} request_id
	 * @param {Partial<{status: string, verifying: boolean, greylist_found: boolean, greylist_found_at: string, blacklist_found: boolean, blacklist_found_at: string, results: string, total_emails: number, completed_emails: number, webhook_sent: boolean, webhook_attempts: number, completed_at: number}>} updates
	 * @returns {Promise<boolean>}
	 */
	async updateResultsDB(request_id, updates) {
		let success = false;
		try {
			// build dynamic UPDATE query
			const keys = Object.keys(updates);
			const setClause = keys.map(key => `${key} = ?`).join(', ');
			const values = keys.map(key => updates[key]);

			const now = new Date().getTime();

			await sqlAsync.runAsync(
				`INSERT INTO ${this.controllerID}Results
				(request_id, ${keys.join(', ')}, created_at, updated_at)
				VALUES (?, ${keys.map(() => '?').join(', ')}, ?, ?)
				ON CONFLICT (request_id) DO UPDATE SET ${setClause}, updated_at = ?`,
				[request_id, ...values, now, now, ...values, now]
			);

			success = true;
		} catch (error) {
			this.logger.error(`updateResultsDB() error -> ${error?.toString()}`);
		} finally {
			return success;
		}
	}

	/**
	 * Get request status and details from local database
	 * @param {string} request_id
	 * @returns {Promise<{request_id: string, status: string, verifying: boolean, greylist_found: boolean, blacklist_found: boolean, results: any, total_emails: number, completed_emails: number, webhook_sent: boolean, webhook_attempts: number, created_at: number, updated_at: number, completed_at: number | null} | null>}
	 */
	async getRequestStatus(request_id) {
		/** @type {any} */
		let status = null;
		try {
			/** @type {any} */
			const dbRes = await sqlAsync.getAsync(`SELECT * FROM ${this.controllerID}Results WHERE request_id = ?`, [
				request_id,
			]);

			if (dbRes) {
				status = {
					request_id: dbRes.request_id,
					status: dbRes.status,
					verifying: !!dbRes.verifying,
					greylist_found: !!dbRes.greylist_found,
					blacklist_found: !!dbRes.blacklist_found,
					results: dbRes.results ? JSON.parse(dbRes.results) : null,
					total_emails: dbRes.total_emails || 0,
					completed_emails: dbRes.completed_emails || 0,
					webhook_sent: !!dbRes.webhook_sent,
					webhook_attempts: dbRes.webhook_attempts || 0,
					created_at: dbRes.created_at,
					updated_at: dbRes.updated_at,
					completed_at: dbRes.completed_at || null,
				};
			}
		} catch (error) {
			this.logger.error(`getRequestStatus() error -> ${error?.toString()}`);
		} finally {
			return status;
		}
	}

	/**
	 * Get completed request results (for API endpoint)
	 * @param {string} request_id
	 * @returns {Promise<VerificationObj[] | null>}
	 */
	async getRequestResults(request_id) {
		try {
			const status = await this.getRequestStatus(request_id);

			if (!status || status.status !== 'completed') {
				return null;
			}

			return status.results;
		} catch (error) {
			this.logger.error(`getRequestResults() error -> ${error?.toString()}`);
			return null;
		}
	}

	/**
	 * Transform controller results to API format for verification_requests table
	 * @param {VerificationObj[]} results - Raw controller results
	 * @returns {Array<{email: string, status: string, message: string}>}
	 */
	transformResultsForAPI(results) {
		return results.map(result => {
			const categorized = categoryFromEmailData(result);

			if (!categorized) {
				return {
					email: result?.email || '',
					status: 'unknown',
					message: 'Invalid email data'
				};
			}

			return {
				email: categorized.email,
				status: categorized.status,
				message: categorized.reason
			};
		});
	}

	/**
	 * Send verification results to HTTP callback URL with retry logic
	 * @param {string} request_id
	 * @param {string} response_url
	 * @param {VerificationObj[]} results
	 * @param {number} totalEmails
	 * @param {number} maxRetries
	 * @returns {Promise<boolean>}
	 */
	async sendResultsCallback(request_id, response_url, results, totalEmails, maxRetries = 5) {
		if (!response_url) {
			this.logger.debug(`No response_url provided for request ${request_id}, skipping callback`);

			// mark as sent since no webhook was required
			await this.updateResultsDB(request_id, {
				webhook_sent: true,
				webhook_attempts: 0,
			});

			return true;
		}

		let webhookSent = false;
		let attemptCount = 0;

		try {
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				attemptCount = attempt;

				try {
					this.logger.debug(`Sending callback for ${request_id} (attempt ${attempt}/${maxRetries})`);

					const response = await axiosPost(response_url, {
						request_id: request_id,
						status: 'completed',
						total_emails: totalEmails,
						completed_emails: results.length,
						results: results,
						timestamp: new Date().toISOString(),
					});

					if (response.success && response.status === 200) {
						this.logger.info(`Callback successful for request ${request_id}`);
						webhookSent = true;
						break;
					}

					this.logger.warn(`Callback attempt ${attempt} failed for ${request_id}: status ${response.status}`);

					if (attempt < maxRetries) {
						await promiseAwait(Math.min(attempt * 2, 10));
					}
				} catch (error) {
					this.logger.error(`Callback attempt ${attempt} error for ${request_id}: ${error?.toString()}`);

					if (attempt < maxRetries) {
						await promiseAwait(Math.min(attempt * 2, 10));
					}
				}
			}

			// update database with webhook delivery status
			await this.updateResultsDB(request_id, {
				webhook_sent: webhookSent,
				webhook_attempts: attemptCount,
			});

			if (!webhookSent) {
				this.logger.error(`All callback attempts failed for request ${request_id}`);
			}

			return webhookSent;
		} catch (error) {
			this.logger.error(`sendResultsCallback() error -> ${error?.toString()}`);

			// track failed webhook attempt in database
			await this.updateResultsDB(request_id, {
				webhook_sent: false,
				webhook_attempts: attemptCount,
			});

			return false;
		}
	}

	/**
	 * Mark the request as 'verifying' in the database (updated to use local SQLite)
	 * @private
	 * @param {string} request_id
	 * @param {number} depth
	 * @returns {Promise<boolean>}
	 */
	async markAsVerifying(request_id, depth = 0) {
		return await this.updateResultsDB(request_id, {
			status: 'processing',
			verifying: true,
		});
	}

	/**
	 * Mark the request as 'greylisted' in the database (updated to use local SQLite)
	 * @private
	 * @param {string} request_id
	 * @param {number} depth
	 * @returns {Promise<boolean>}
	 */
	async markGreylisted(request_id, depth = 0) {
		const now = new Date().toISOString();
		return await this.updateResultsDB(request_id, {
			greylist_found: true,
			greylist_found_at: now,
		});
	}

	/**
	 * Mark the request as 'blacklisted' in the database (updated to use local SQLite)
	 * @private
	 * @param {string} request_id
	 * @param {number} depth
	 * @returns {Promise<boolean>}
	 */
	async markBlacklisted(request_id, depth = 0) {
		const now = new Date().toISOString();
		return await this.updateResultsDB(request_id, {
			blacklist_found: true,
			blacklist_found_at: now,
		});
	}

	/**
	 * Push to the database
	 * @protected
	 * @param {number} workerIndex
	 * @param {RequestObj | null} request
	 */
	async pushDB(workerIndex, request) {
		let success = false;
		try {
			const requestStr = request ? JSON.stringify(request) : '';

			await sqlAsync.runAsync(
				`INSERT INTO ${this.controllerID} (workerIndex, request, created_at) VALUES (?, ?, ?)
				ON CONFLICT (workerIndex) DO UPDATE SET request = EXCLUDED.request, created_at = EXCLUDED.created_at`,
				[workerIndex, requestStr, new Date().getTime()]
			);

			success = true;
		} catch (error) {
			this.logger.error(`pushDB() error -> ${error?.toString()}`);
		} finally {
			return success;
		}
	}

	/** Get from database
	 * @protected
	 * @param {number} workerIndex
	 */
	async pullDB(workerIndex) {
		/** @type {RequestObj | null} */
		let request = null;
		try {
			// get the request from the databases
			/** @type {any} */
			const dbRes = await sqlAsync.getAsync(`SELECT * FROM ${this.controllerID} WHERE workerIndex = ?`, [
				workerIndex,
			]);
			if (dbRes?.request) {
				const requestObj = JSON.parse(dbRes?.request);
				request = {
					request_id: requestObj?.request_id,
					emails: requestObj?.emails,
					response_url: requestObj?.response_url,
				};
			}
		} catch (error) {
			this.logger.error(`pullDB() error -> ${error?.toString()}`);
		} finally {
			return request;
		}
	}

	/** Delete from the database
	 * @protected
	 * @param {number} workerIndex
	 */
	async deleteFromDB(workerIndex) {
		let success = false;
		try {
			await sqlAsync.runAsync(`DELETE FROM ${this.controllerID} WHERE workerIndex = ?`, [workerIndex]);
			success = true;
		} catch (error) {
			this.logger.error(`deleteFromDB() error -> ${error?.toString()}`);
			success = false;
		} finally {
			return success;
		}
	}

	/**
	 * Sync from the database
	 * @private
	 */
	async syncDB() {
		try {
			// get all the requests from the database
			/** @type {any} */
			const workerRequests = await sqlAsync.allAsync(`SELECT * FROM ${this.controllerID} ORDER BY workerIndex`);

			console.log(
				`SYNC worker requests -> `,
				workerRequests?.map((/** @type {any} */ req) => ({
					workerIndex: parseInt(req?.workerIndex || ''),
					requestExists: !!req?.request,
				}))
			);

			for (const workerRequest of workerRequests) {
				const workerIndex = parseInt(workerRequest?.workerIndex || ''),
					request = workerRequest?.request || null,
					created_at = parseInt(workerRequest?.created_at || null);

				// check if the request data can be parsed
				let canParse = false,
					/** @type {RequestObj | null} */
					parsedRequest = null;
				try {
					parsedRequest = JSON.parse(request);
					canParse = true;
				} catch (error) {}

				// delete faulty entries
				if (
					!workerRequest?.workerIndex ||
					!request ||
					!created_at ||
					workerIndex >= this.threads_num ||
					!canParse
				) {
					await sqlAsync.runAsync(`DELETE FROM ${this.controllerID} WHERE id = ?`, [workerRequest?.id]);
					continue;
				}

				// update the assignment and assign the worker
				if (parsedRequest) this.assign(workerIndex, parsedRequest);
			}
		} catch (error) {
			this.logger.error(`syncDB() error -> ${error?.toString()}`);
		}
	}

	/**
	 * Push to the request archive database
	 * @param {string} request_id
	 * @param {RequestObj & {result: Map<string, VerificationObj>, created_at: number}} value
	 */
	async pushArchive(request_id, value) {
		try {
			// Get the constituents of the value
			const result = value?.result || new Map(),
				emails = value?.emails || [],
				response_url = value?.response_url || '',
				created_at = value?.created_at || 0;

			// save the details to the databaes + check for already existing entries
			await sqlAsync.runAsync(
				`INSERT INTO ${this.controllerID}Archive
				(request_id, emails, result, response_url, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (request_id) DO UPDATE SET result = EXCLUDED.result`,
				[
					request_id,
					JSON.stringify(emails),
					JSON.stringify(Array.from(result.entries())),
					response_url,
					created_at,
				]
			);
		} catch (error) {
			this.logger.error(`pushArchive() error -> ${error?.toString()}`);
		}
	}

	/**
	 * Restore archive entries from database to memory on startup
	 * This ensures partial results are not lost during crash recovery
	 */
	async syncArchive() {
		let restoredCount = 0;
		let errorCount = 0;

		try {
			/** @type {any} */
			const archiveRes = await sqlAsync.allAsync(`SELECT * FROM ${this.controllerID}Archive`);

			this.logger.info(`Restoring ${archiveRes.length} archive entries from database...`);

			for (const arch of archiveRes) {
				try {
					const request_id = arch?.request_id || '';

					if (!request_id) {
						this.logger.warn(`Skipping archive entry with missing request_id`);
						errorCount++;
						continue;
					}

					const emails = JSON.parse(arch?.emails || '[]');
					const response_url = arch?.response_url || '';
					const result = new Map(JSON.parse(arch?.result || '[]'));
					const created_at = parseInt(arch?.created_at || '0');

					this.request_archive.set(request_id, {
						request_id,
						emails,
						response_url,
						result,
						created_at,
					});

					restoredCount++;
				} catch (parseError) {
					this.logger.error(`Failed to parse archive entry: ${parseError?.toString()}`);
					errorCount++;
				}
			}

			this.logger.info(`Archive restoration complete: ${restoredCount} restored, ${errorCount} errors`);
		} catch (error) {
			this.logger.error(`syncArchive() error -> ${error?.toString()}`);
		}
	}

	/**
	 * Tiered cleanup for controller0Archive table
	 * Tier 1: Completed requests → clean after 24 hours
	 * Tier 2: Orphans/Processing → clean after 7 days
	 */
	async purgeArchive() {
		try {
			const now = new Date().getTime();
			const tier1Deadline = now - 1000 * 60 * 60 * 24; // 24 hours
			const tier2Deadline = now - 1000 * 60 * 60 * 24 * 7; // 7 days

			// Tier 1: Delete completed requests older than 24 hours
			await sqlAsync.runAsync(
				`DELETE FROM ${this.controllerID}Archive
				 WHERE request_id IN (
					SELECT a.request_id
					FROM ${this.controllerID}Archive a
					INNER JOIN ${this.controllerID}Results r ON a.request_id = r.request_id
					WHERE r.status = 'completed'
					AND r.completed_at IS NOT NULL
					AND r.completed_at < ?
				 )`,
				[tier1Deadline]
			);

			// Tier 2: Delete orphans/processing requests older than 7 days
			await sqlAsync.runAsync(
				`DELETE FROM ${this.controllerID}Archive
				 WHERE created_at < ?
				 AND request_id NOT IN (
					SELECT request_id FROM ${this.controllerID}Results WHERE status = 'completed'
				 )`,
				[tier2Deadline]
			);

			this.logger.debug(`Archive cleanup completed: tier1 (24h+), tier2 (7d+)`);
		} catch (error) {
			this.logger.error(`purgeArchive() error -> ${error?.toString()}`);
		}
	}

	/**
	 * Continuous archive cleanup (runs every hour)
	 */
	async purgeArchiveRec() {
		try {
			await this.purgeArchive();
		} catch (error) {
			this.logger.error(`purgeArchiveRec() error -> ${error?.toString()}`);
		} finally {
			await promiseAwait(60 * 60); // run every 1 hour

			this.purgeArchiveRec();
		}
	}

	/**
	 * Update disposable email domains list from remote API
	 * Merges new domains with existing ones (additive, never removes)
	 * @private
	 */
	async updateDisposableList() {
		try {
			this.logger.info('Updating disposable email domains list...');

			// Fetch latest from API
			const apiRes = await axiosGet('https://rawcdn.githack.com/disposable/disposable-email-domains/master/domains.json');

			if (!apiRes || apiRes.status !== 200) {
				this.logger.warn('Failed to fetch disposable list: invalid response');
				return;
			}

			const newDomains = apiRes?.data || [];

			if (!Array.isArray(newDomains) || newDomains.length === 0) {
				this.logger.warn('Failed to fetch disposable list: invalid data format');
				return;
			}

			// Load existing list from file
			const listPath = path.join(__dirname, '../../data/lists/disposableDomainsList.js');

			// Clear require cache to get fresh data
			delete require.cache[require.resolve('../../data/lists/disposableDomainsList')];
			const existingList = require('../../data/lists/disposableDomainsList');

			// Merge: Add new domains to existing (ADDITIVE - never remove old domains)
			const mergedSet = new Set([...existingList, ...newDomains]);

			const addedCount = mergedSet.size - existingList.size;

			// Only write if there are new domains
			if (addedCount > 0) {
				// Create file content
				const fileContent = `/**
 * Disposable email domains list
 * Auto-generated from: https://rawcdn.githack.com/disposable/disposable-email-domains/master/domains.json
 * Last updated: ${new Date().toISOString()}
 * Total domains: ${mergedSet.size}
 */
const disposableDomainsList = new Set(${JSON.stringify([...mergedSet], null, '\t')});

module.exports = disposableDomainsList;
`;

				// Write to file
				fs.writeFileSync(listPath, fileContent, 'utf8');

				this.logger.info(`✅ Updated disposable domains list: +${addedCount} new domains (total: ${mergedSet.size})`);
			} else {
				this.logger.info(`✅ Disposable domains list is up to date (${mergedSet.size} domains)`);
			}
		} catch (error) {
			this.logger.error(`updateDisposableList() error -> ${error?.toString()}`);
			this.logger.warn('Will retry in 3 days...');
		}
	}

	/**
	 * Continuous disposable list updater (runs every 3 days)
	 * Workers will automatically use the updated list on next restart
	 * @private
	 */
	async updateDisposableListRec() {
		try {
			await this.updateDisposableList();
		} catch (error) {
			this.logger.error(`updateDisposableListRec() error -> ${error?.toString()}`);
		} finally {
			// Run every 3 days (72 hours)
			await promiseAwait(3 * 24 * 60 * 60); // 3 days in seconds

			this.updateDisposableListRec();
		}
	}

	/**
	 * This process will handle ping from the worker & will update the workers_last_ping time
	 * @param {number} workerIndex
	 */
	ping(workerIndex) {
		this.workers_last_ping[workerIndex] = new Date().getTime();
		// console.log(`Ping from worker ${workerIndex}`);
	}
}

const controller = new Controller(`controller0`);

module.exports = controller;
module.exports.Controller = Controller;
