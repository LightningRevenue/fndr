/**
 * API utility functions for simple authentication and HTTP requests
 * Uses centralized axios utilities for consistent error handling and type safety
 */

import { axiosGet, axiosPost, axiosDelete } from './axios';
import { config } from '../data/env';
import { formatErrorMessage } from './utils';


// API response type definitions

/**
 * Simple login response interface
 * No tokens, just user email
 */
export interface LoginResponse {
    success: boolean;
    message: string;
    data: {
        user: {
            email: string;
        };
    };
}

/**
 * Generic API response interface for simple operations
 */
export interface GenericApiResponse {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
}


// Simple Auth API

/**
 * User info interface
 * Represents current authenticated user
 */
export interface UserInfo {
    email: string;
}

/**
 * Get current user response interface
 */
export interface GetCurrentUserResponse {
    success: boolean;
    data: {
        user: UserInfo;
    };
}

/**
 * Logout response interface
 */
export interface LogoutResponse {
    success: boolean;
    message: string;
}

/**
 * Authentication API with session management
 */
export const authApi = {
    /**
     * Authenticate user with email and password
     * Creates session on successful authentication
     *
     * @param {string} email - User email address
     * @param {string} password - User password
     * @returns {Promise<LoginResponse>} Promise resolving to login response with user email
     * @throws {Error} If credentials are invalid or network error occurs
     */
    async login(email: string, password: string): Promise<LoginResponse> {
        try {
            const response = await axiosPost<LoginResponse>(
                `${config.api.baseUrl}/api/auth/login`,
                { email, password }
            );

            if (!response.success) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Login failed');
                (error as any).status = response.status;
                throw error;
            }

            return response.data!;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Login failed';
            const statusCode = (error as any)?.status;
            const validationErrors = (error as any)?.validationErrors;
            throw new Error(formatErrorMessage(message, statusCode, validationErrors));
        } finally {
            // Debug logging omitted for production
        }
    },

    /**
     * Get current authenticated user
     * Verifies session and returns user information
     *
     * @returns {Promise<UserInfo>} Promise resolving to current user info
     * @throws {Error} If not authenticated or request fails
     */
    async getCurrentUser(): Promise<UserInfo> {
        try {
            const response = await axiosGet<GetCurrentUserResponse>(
                `${config.api.baseUrl}/api/auth/me`
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to get user info');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data.user;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get user info';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        } finally {
            // Debug logging omitted for production
        }
    },

    /**
     * Logout current user
     * Destroys session and clears authentication
     *
     * @returns {Promise<void>} Promise resolving when logout is complete
     * @throws {Error} If logout fails
     */
    async logout(): Promise<void> {
        try {
            const response = await axiosPost<LogoutResponse>(
                `${config.api.baseUrl}/api/auth/logout`,
                {}
            );

            if (!response.success) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Logout failed');
                (error as any).status = response.status;
                throw error;
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Logout failed';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        } finally {
            // Debug logging omitted for production
        }
    },
};


// API Key Management Types

/**
 * API key interface
 * Represents an API key in the list view (with masked key)
 */
export interface ApiKey {
    id: number;
    name: string;
    key_masked: string;
    expires_at: string | null;
    is_revoked: boolean;
    last_used: string | null;
    created_at: string;
}

/**
 * Create API key response interface
 * Returned after successfully creating a new API key
 */
export interface CreateApiKeyResponse {
    success: boolean;
    message: string;
    data: {
        apiKey: string;
        keyData: {
            id: number;
            name: string;
            key_prefix: string;
            expires_at: string | null;
            created_at: string;
        };
    };
}

/**
 * List API keys response interface
 * Contains list of all API keys for a user
 */
export interface ListApiKeysResponse {
    success: boolean;
    data: {
        apiKeys: ApiKey[];
    };
}

/**
 * Revoke API key response interface
 * Confirmation of API key revocation
 */
export interface RevokeApiKeyResponse {
    success: boolean;
    message: string;
    data: {
        id: number;
        name: string;
        revoked_at: string;
    };
}


// CSV Verification API Types

/**
 * CSV upload response interface
 * Returned after successfully uploading a CSV file (now includes detection results)
 */
export interface CSVUploadResponse {
    success: boolean;
    csv_upload_id: string;
    original_filename: string;
    list_name: string | null;
    has_header: boolean;
    preview: Record<string, string>[];
    headers: string[];
    row_count: number;
    column_count: number;
    file_size: number;
    detected_column: string;
    detected_column_index: number;
    confidence: number;
    column_scores: Record<string, number>;
    upload_status: 'ready' | 'submitted';
}

/**
 * CSV verification submission response interface
 * Returned after submitting CSV for verification
 */
export interface CSVVerificationResponse {
    success: boolean;
    message: string;
    csv_upload_id: string;
    verification_request_id: string;
    upload_status: 'submitted';
    verification_status: 'pending' | 'processing' | 'completed' | 'failed';
    total_emails: number;
}

/**
 * Verification request details interface
 * Contains full details of a verification request
 */
export interface VerificationRequest {
    verification_request_id: string;
    request_type: 'single' | 'csv' | 'api';
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress_step?: 'received' | 'processing' | 'antiGreyListing' | 'complete' | 'failed';
    greylist_found?: boolean;
    blacklist_found?: boolean;
    emails?: string[];
    results?: VerificationResult[];
    pagination?: {
        page: number;
        per_page: number;
        total: number;
        total_pages: number;
        has_more: boolean;
    };
    statistics?: VerificationStatistics;
    created_at: number;
    updated_at?: number;
    completed_at?: number;
    csv_details?: CSVDetails;
}

/**
 * CSV details interface
 * Contains CSV-specific metadata
 */
export interface CSVDetails {
    csv_upload_id: string;
    list_name?: string | null;
    original_filename: string;
    row_count: number;
    column_count: number;
    has_header: boolean;
    headers: string[];
    selected_email_column: string;
    detection_confidence: number;
    download_url: string;
}

/**
 * Verification result interface
 * Contains the verification result for a single email
 */
export interface VerificationResult {
    email: string;
    status: 'valid' | 'invalid' | 'catch-all' | 'unknown';
    message: string;
}

/**
 * Verification statistics interface
 * Contains aggregated statistics for verification results
 */
export interface VerificationStatistics {
    total_emails: number;
    valid: number;
    invalid: number;
    catch_all: number;
    unknown: number;
    percentages: {
        valid: number;
        invalid: number;
        catch_all: number;
        unknown: number;
    };
}

/**
 * Verification history item interface
 * Summary of a verification request in history list
 */
export interface VerificationHistoryItem {
    verification_request_id: string;
    request_type: 'single' | 'csv' | 'api';
    email_count: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    created_at: number;
    updated_at: number;
    completed_at?: number;
    csv_upload_id?: string;
    list_name?: string | null;
    original_filename?: string;
    file_size?: number;
    status_url?: string;
    results_url?: string | null;
    download_url?: string | null;
}

/**
 * History response interface
 * Paginated list of verification requests
 */
export interface HistoryResponse {
    success: boolean;
    requests: VerificationHistoryItem[];
    total: number;
    page: number;
    per_page: number;
}


/**
 * Port 25 connectivity check response
 */
export interface Port25CheckResponse {
    success: boolean;
    port25Open: boolean;
    canVerifyEmails: boolean;
    testedHost: string | null;
    provider: string | null;
    attemptedHosts: string[];
    responseTime: number | null;
    totalTime: number;
    smtpBanner: string | null;
    error: string | null;
    errors: Array<{
        host: string;
        provider: string;
        error: string;
        reason: string;
        severity: string;
        blocked: boolean | string;
    }>;
    recommendation: string | null;
    timestamp: string;
}


// CSV Verification API Operations

/**
 * CSV Verification API functions with comprehensive error handling
 * Provides all CSV verification-related operations
 */
export const verificationApi = {
    /**
     * Upload CSV file and detect email column in one step
     * Uploads file, parses structure, generates preview, and detects email column
     *
     * @param {FormData} formData - FormData containing csvFile, list_name, and has_header
     * @returns {Promise<CSVUploadResponse>} Promise resolving to upload and detection response
     * @throws {Error} If file is invalid or upload fails
     */
    async uploadCSV(formData: FormData): Promise<CSVUploadResponse> {
        try {
            const response = await axiosPost<{
                success: boolean;
                data: CSVUploadResponse;
            }>(
                `${config.api.baseUrl}/api/verifier/csv/upload`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'CSV upload failed');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'CSV upload failed';
            const statusCode = (error as any)?.status;
            const validationErrors = (error as any)?.validationErrors;
            throw new Error(formatErrorMessage(message, statusCode, validationErrors));
        }
    },

    /**
     * Submit CSV for verification
     * Extracts emails from selected column and queues for verification
     *
     * @param {string} csvUploadId - CSV upload ID
     * @param {number} emailColumnIndex - Index of column containing emails
     * @returns {Promise<CSVVerificationResponse>} Promise resolving to verification start confirmation
     * @throws {Error} If submission fails
     */
    async submitCSVVerification(csvUploadId: string, emailColumnIndex: number): Promise<CSVVerificationResponse> {
        try {
            const response = await axiosPost<{
                success: boolean;
                message: string;
                data: {
                    csv_upload_id: string;
                    verification_request_id: string;
                    upload_status: 'submitted';
                    verification_status: 'pending' | 'processing' | 'completed' | 'failed';
                    total_emails: number;
                }
            }>(
                `${config.api.baseUrl}/api/verifier/csv/verify`,
                { csv_upload_id: csvUploadId, email_column_index: emailColumnIndex }
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Verification submission failed');
                (error as any).status = response.status;
                throw error;
            }

            return {
                success: response.success,
                message: response.data.message,
                ...response.data.data
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Verification submission failed';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        }
    },

    /**
     * Get verification status
     * Retrieves only status and progress information, NO results
     * Use this for polling verification progress
     *
     * @param {string} verificationRequestId - Verification request ID
     * @returns {Promise<VerificationRequest>} Promise resolving to verification status
     * @throws {Error} If request not found or retrieval fails
     */
    async getVerificationStatus(verificationRequestId: string): Promise<VerificationRequest> {
        try {
            const url = `${config.api.baseUrl}/api/verifier/verification/${verificationRequestId}/status`;

            const response = await axiosGet<{
                success: boolean;
                data: VerificationRequest;
            }>(url);

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to get verification status');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get verification status';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        }
    },

    /**
     * Get verification results
     * Retrieves paginated results for completed verifications
     * Use this to fetch results after verification is complete
     *
     * @param {string} verificationRequestId - Verification request ID
     * @param {number} page - Page number for pagination (default: 1)
     * @param {number} perPage - Results per page (default: 20)
     * @returns {Promise<VerificationRequest>} Promise resolving to verification results
     * @throws {Error} If request not found or verification not completed
     */
    async getVerificationResults(verificationRequestId: string, page: number = 1, perPage: number = 20): Promise<VerificationRequest> {
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('page', page.toString());
            queryParams.append('per_page', perPage.toString());

            const url = `${config.api.baseUrl}/api/verifier/verification/${verificationRequestId}/results?${queryParams.toString()}`;

            const response = await axiosGet<{
                success: boolean;
                data: VerificationRequest;
            }>(url);

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to get verification results');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get verification results';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        }
    },

    /**
     * Get verification history
     * Retrieves paginated list of all verification requests
     *
     * @param {Object} params - Query parameters
     * @param {number} params.page - Page number (default: 1)
     * @param {number} params.per_page - Items per page (default: 50)
     * @param {string} params.type - Filter by request type
     * @param {string} params.status - Filter by status
     * @param {string} params.period - Filter by time period
     * @returns {Promise<HistoryResponse>} Promise resolving to history list
     * @throws {Error} If retrieval fails
     */
    async getHistory(params?: {
        page?: number;
        per_page?: number;
        type?: 'single' | 'csv' | 'api';
        status?: 'pending' | 'processing' | 'completed' | 'failed';
        period?: 'this_month' | 'last_month' | 'last_6_months';
    }): Promise<HistoryResponse> {
        try {
            const queryParams = new URLSearchParams();
            if (params?.page) queryParams.append('page', params.page.toString());
            if (params?.per_page) queryParams.append('per_page', params.per_page.toString());
            if (params?.type) queryParams.append('type', params.type);
            if (params?.status) queryParams.append('status', params.status);
            if (params?.period) queryParams.append('period', params.period);

            const url = `${config.api.baseUrl}/api/verifier/history${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

            const response = await axiosGet<{
                success: boolean;
                data: {
                    requests: VerificationHistoryItem[];
                    total: number;
                    page: number;
                    per_page: number;
                }
            }>(url);

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to get history');
                (error as any).status = response.status;
                throw error;
            }

            return {
                success: response.success,
                ...response.data.data
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get history';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        }
    },

    /**
     * Download CSV results
     * Downloads CSV file with verification results appended
     *
     * @param {string} csvUploadId - CSV upload ID
     * @returns {Promise<Blob>} Promise resolving to CSV file blob
     * @throws {Error} If download fails
     */
    async downloadCSVResults(csvUploadId: string): Promise<Blob> {
        try {
            const response = await fetch(
                `${config.api.baseUrl}/api/verifier/csv/${csvUploadId}/download`,
                {
                    method: 'GET',
                }
            );

            if (!response.ok) {
                throw new Error(`Download failed with status ${response.status}`);
            }

            const blob = await response.blob();
            return blob;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to download CSV results';
            throw new Error(formatErrorMessage(message));
        }
    },

    /**
     * Verify single email address
     * Submits a single email for verification
     *
     * @param {string} email - Email address to verify
     * @returns {Promise<{ verification_request_id: string; message: string }>} Promise resolving to verification request ID
     * @throws {Error} If verification fails
     */
    async verifySingleEmail(email: string): Promise<{ verification_request_id: string; message: string }> {
        try {
            const response = await axiosPost<{
                success: boolean;
                message: string;
                data: {
                    verification_request_id: string;
                    email: string;
                    status: string;
                }
            }>(
                `${config.api.baseUrl}/api/verifier/verify-single`,
                { email }
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Single email verification failed');
                (error as any).status = response.status;
                throw error;
            }

            return {
                verification_request_id: response.data.data.verification_request_id,
                message: response.data.message
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Single email verification failed';
            const statusCode = (error as any)?.status;
            const validationErrors = (error as any)?.validationErrors;
            throw new Error(formatErrorMessage(message, statusCode, validationErrors));
        }
    },


    /**
     * Check port 25 connectivity
     * Verifies if outbound SMTP port 25 is accessible for email verification
     *
     * @returns {Promise<Port25CheckResponse>} Promise resolving to port 25 connectivity status
     * @throws {Error} If connectivity check fails
     */
    async checkPort25(): Promise<Port25CheckResponse> {
        try {
            const response = await axiosGet<{
                success: boolean;
                data: Port25CheckResponse;
            }>(`${config.api.baseUrl}/api/verifier/port25-check`);

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Port 25 check failed');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Port 25 connectivity check failed';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        }
    },
};


// Valid Emails DB

export interface ValidEmailEntry {
    email: string;
    domain: string;
    source: 'single' | 'csv' | 'api';
    verified_at: number;
}

export interface ValidEmailsDomain {
    domain: string;
    count: number;
}

export interface ValidEmailsResponse {
    success: boolean;
    data: {
        domains: ValidEmailsDomain[];
        emails: ValidEmailEntry[];
        total: number;
    };
}

export const validEmailsApi = {
    async getValidEmails(page = 1, perPage = 50, domain: string | null = null): Promise<ValidEmailsResponse['data']> {
        try {
            const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
            if (domain) params.set('domain', domain);

            const response = await axiosGet<ValidEmailsResponse>(
                `${config.api.baseUrl}/api/verifier/valid-emails?${params.toString()}`
            );

            if (!response.success || !response.data) {
                throw new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to fetch valid emails');
            }

            return response.data.data;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch valid emails';
            throw new Error(formatErrorMessage(errorMessage));
        } finally {
            // no-op
        }
    },
};


// API Key Management API Operations

/**
 * API Key Management API functions with comprehensive error handling
 * Provides all API key management operations
 */
export const apiKeyApi = {
    /**
     * Create a new API key
     * Generates new API key with optional expiry
     *
     * @param {string} name - Descriptive name for the API key
     * @param {number | null} expiryDays - Number of days until expiry (null for no expiry)
     * @returns {Promise<CreateApiKeyResponse['data']>} Promise resolving to API key and metadata
     * @throws {Error} If creation fails or user has reached maximum limit
     */
    async createApiKey(name: string, expiryDays: number | null = null): Promise<CreateApiKeyResponse['data']> {
        try {
            const requestBody: { name: string; expiryDays?: number } = { name };
            if (expiryDays !== null) {
                requestBody.expiryDays = expiryDays;
            }

            const response = await axiosPost<CreateApiKeyResponse>(
                `${config.api.baseUrl}/api/api-keys/create`,
                requestBody
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to create API key');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create API key';
            const statusCode = (error as any)?.status;
            const validationErrors = (error as any)?.validationErrors;
            throw new Error(formatErrorMessage(message, statusCode, validationErrors));
        } finally {
            // Debug logging omitted for production
        }
    },

    /**
     * List all API keys for the authenticated user
     * Returns masked API keys with metadata
     *
     * @returns {Promise<ApiKey[]>} Promise resolving to list of API keys
     * @throws {Error} If retrieval fails
     */
    async listApiKeys(): Promise<ApiKey[]> {
        try {
            const response = await axiosGet<ListApiKeysResponse>(
                `${config.api.baseUrl}/api/api-keys`
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to list API keys');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data.apiKeys;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to list API keys';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        } finally {
            // Debug logging omitted for production
        }
    },

    /**
     * Revoke an API key by ID
     * Permanently revokes an API key (cannot be undone)
     *
     * @param {number} keyId - The API key ID to revoke
     * @returns {Promise<RevokeApiKeyResponse['data']>} Promise resolving to revocation confirmation
     * @throws {Error} If revocation fails or key doesn't belong to user
     */
    async revokeApiKey(keyId: number): Promise<RevokeApiKeyResponse['data']> {
        try {
            const response = await axiosDelete<RevokeApiKeyResponse>(
                `${config.api.baseUrl}/api/api-keys/${keyId}/revoke`
            );

            if (!response.success || !response.data) {
                const error = new Error(response.error instanceof Error ? response.error.message : response.error || 'Failed to revoke API key');
                (error as any).status = response.status;
                throw error;
            }

            return response.data.data;

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to revoke API key';
            const statusCode = (error as any)?.status;
            throw new Error(formatErrorMessage(message, statusCode));
        } finally {
            // Debug logging omitted for production
        }
    },
};