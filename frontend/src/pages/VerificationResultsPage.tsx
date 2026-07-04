/**
 * Verification Results Page
 * Displays verification results with analysis and detailed email list
 * Features infinite scroll pagination with Intersection Observer
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, DatabaseZap } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '../components/layout';
import { Button } from '../components/ui/Button';
import { ResultAnalysis } from '../components/results/ResultAnalysis';
import { ResultsList } from '../components/results/ResultsList';
import { Skeleton } from '../components/ui/Skeleton';
import { verificationApi } from '../lib/api';
import { config } from '../data/env';
import { toast } from 'react-toastify';


// ============================================================
// INFINITE SCROLL CONFIGURATION - Modify these values as needed
// ============================================================
const SCROLL_CONFIG = {
    INITIAL_PAGE: 1,              // First page to load
    THRESHOLD: 0.8,               // Trigger at 80% scroll (20% from bottom)
    ROOT_MARGIN: '200px',         // Start loading 200px before reaching threshold
};
// ============================================================


// Email verification result interface
export interface EmailVerificationResult {
    email: string;
    status: 'valid' | 'invalid' | 'catch-all' | 'unknown';
    reason: string;
}


// Interface for component props (for backward compatibility when used as component)
interface VerificationResultsPageProps {
    results?: EmailVerificationResult[];
    onBack?: () => void;
}


/**
 * Verification Results Page Component
 * @param props - Component props (optional, for backward compatibility)
 * @returns JSX element
 */
export function VerificationResultsPage({
    results: propsResults,
    onBack: propsOnBack,
}: VerificationResultsPageProps = {}) {
    const navigate = useNavigate();
    const { verificationRequestId } = useParams<{ verificationRequestId: string }>();

    // State for fetched results
    const [results, setResults] = useState<EmailVerificationResult[]>(propsResults || []);
    const [loading, setLoading] = useState<boolean>(!propsResults);
    const [error, setError] = useState<string>('');
    const [page, setPage] = useState<number>(SCROLL_CONFIG.INITIAL_PAGE);
    const [hasMore, setHasMore] = useState<boolean>(true);
    const [isFetchingMore, setIsFetchingMore] = useState<boolean>(false);
    const [csvUploadId, setCsvUploadId] = useState<string | undefined>(undefined);
    const [listName, setListName] = useState<string | null | undefined>(undefined);
    const [originalFilename, setOriginalFilename] = useState<string | undefined>(undefined);
    const [statistics, setStatistics] = useState<{
        valid: number;
        invalid: number;
        catch_all: number;
        unknown: number;
    } | null>(null);

    const [syncing, setSyncing] = useState(false);

    // Ref for intersection observer (using callback ref for better timing)
    const observerTarget = useRef<HTMLDivElement>(null);
    const [observerElement, setObserverElement] = useState<HTMLDivElement | null>(null);


    // Fetch initial results from API if not provided via props
    useEffect(() => {
        if (propsResults || !verificationRequestId) return;

        const fetchResults = async () => {
            try {
                setLoading(true);
                setError('');

                const details = await verificationApi.getVerificationResults(verificationRequestId, page);

                if (details.status !== 'completed') {
                    setError('Verification is not completed yet');
                    return;
                }

                // Map API results to local format
                const mappedResults: EmailVerificationResult[] = (details.results || []).map(r => ({
                    email: r.email,
                    status: r.status,
                    reason: r.message
                }));

                setResults(mappedResults);

                // Check if there are more pages
                if (details.pagination) {
                    setHasMore(details.pagination.has_more);
                }

                // Store statistics from API response
                if (details.statistics) {
                    setStatistics(details.statistics);
                }

                // Store CSV details if this is a CSV verification
                if (details.request_type === 'csv' && details.csv_details) {
                    setCsvUploadId(details.csv_details.csv_upload_id);
                    setListName(details.csv_details.list_name);
                    setOriginalFilename(details.csv_details.original_filename);
                }

            } catch (error) {
                console.error('Failed to fetch results:', error);
                setError(error instanceof Error ? error.message : 'Failed to load results');
            } finally {
                setLoading(false);
            }
        };

        fetchResults();
    }, [verificationRequestId, propsResults]);


    // Fetch more results when user scrolls (memoized to prevent unnecessary recreations)
    const fetchMoreResults = useCallback(async () => {
        if (isFetchingMore || !hasMore || !verificationRequestId) return;

        try {
            setIsFetchingMore(true);
            const nextPage = page + 1;

            const details = await verificationApi.getVerificationResults(verificationRequestId, nextPage);

            if (details.results && details.results.length > 0) {
                const mappedResults: EmailVerificationResult[] = details.results.map(r => ({
                    email: r.email,
                    status: r.status,
                    reason: r.message
                }));

                setResults(prev => [...prev, ...mappedResults]);
                setPage(nextPage);

                if (details.pagination) {
                    setHasMore(details.pagination.has_more);
                }
            } else {
                setHasMore(false);
            }

        } catch (error) {
            console.error('Failed to fetch more results:', error);
        } finally {
            setIsFetchingMore(false);
        }
    }, [isFetchingMore, hasMore, verificationRequestId, page]);


    // Intersection Observer for infinite scroll (more performant than scroll events)
    useEffect(() => {
        // Wait until element is available and we have more results to load
        if (!observerElement || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // When the target element becomes visible, fetch more results
                if (entries[0].isIntersecting && !isFetchingMore) {
                    fetchMoreResults();
                }
            },
            {
                root: null, // viewport
                rootMargin: SCROLL_CONFIG.ROOT_MARGIN,
                threshold: 0.1, // Trigger when 10% of element is visible
            }
        );

        observer.observe(observerElement);

        return () => observer.disconnect();
    }, [observerElement, fetchMoreResults, hasMore, isFetchingMore]);


    // Handle back navigation
    const handleBack = () => {
        try {
            if (propsOnBack) {
                // Component mode - use provided callback
                propsOnBack();
            } else {
                // Route mode - navigate to dashboard
                navigate('/dashboard', { replace: true });
            }
        } catch (error) {
            console.error('Back navigation error:', error);
        }
    };




    try {
        // Show loading state
        if (loading) {
            return (
                <DashboardLayout
                    
                    
                >
                    <div className="px-4 sm:px-6 lg:px-8 py-8">
                        {/* Header skeleton */}
                        <div className="mb-8">
                            <div className="flex items-center space-x-4">
                                <Skeleton className="h-8 w-32" />
                            </div>
                        </div>

                        {/* Results Grid Skeleton */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Left column - Result Analysis Skeleton */}
                            <div className="space-y-6">
                                {/* Card 1 - Stats */}
                                <div className="bg-white border border-gray-200 rounded-lg p-6">
                                    <Skeleton className="h-6 w-32 mb-4" />
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Skeleton className="h-8 w-20 mb-2" />
                                            <Skeleton className="h-4 w-16" />
                                        </div>
                                        <div>
                                            <Skeleton className="h-8 w-20 mb-2" />
                                            <Skeleton className="h-4 w-16" />
                                        </div>
                                        <div>
                                            <Skeleton className="h-8 w-20 mb-2" />
                                            <Skeleton className="h-4 w-16" />
                                        </div>
                                        <div>
                                            <Skeleton className="h-8 w-20 mb-2" />
                                            <Skeleton className="h-4 w-16" />
                                        </div>
                                    </div>
                                </div>

                                {/* Card 2 - Chart */}
                                <div className="bg-white border border-gray-200 rounded-lg p-6">
                                    <Skeleton className="h-6 w-40 mb-4" />
                                    <Skeleton className="h-48 w-full" />
                                </div>
                            </div>

                            {/* Right column - Results List Skeleton */}
                            <div>
                                <div className="bg-white border border-gray-200 rounded-lg">
                                    {/* Header */}
                                    <div className="p-6 border-b border-gray-200">
                                        <div className="flex items-center justify-between">
                                            <Skeleton className="h-6 w-48" />
                                            <Skeleton className="h-9 w-32" />
                                        </div>
                                    </div>

                                    {/* List items */}
                                    <div className="p-6 space-y-3">
                                        {Array.from({ length: 8 }).map((_, index) => (
                                            <div key={index} className="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg">
                                                <Skeleton className="h-5 w-5 rounded-full flex-shrink-0" />
                                                <div className="flex-1">
                                                    <Skeleton className="h-4 w-full mb-2" />
                                                    <Skeleton className="h-3 w-3/4" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </DashboardLayout>
            );
        }

        // Show error state
        if (error) {
            return (
                <DashboardLayout
                    
                    
                >
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center space-y-4 p-8">
                            <p className="text-lg font-medium text-red-600">
                                Failed to load results
                            </p>
                            <p className="text-sm text-gray-600">
                                {error}
                            </p>
                            <Button
                                onClick={handleBack}
                                variant="primary"
                                className="cursor-pointer"
                            >
                                Go Back
                            </Button>
                        </div>
                    </div>
                </DashboardLayout>
            );
        }

        // Use statistics from API if available, otherwise calculate from loaded results
        const stats = statistics
            ? {
                total: statistics.valid + statistics.invalid + statistics.catch_all + statistics.unknown,
                valid: statistics.valid,
                invalid: statistics.invalid,
                catchAll: statistics.catch_all,
                unknown: statistics.unknown
            }
            : {
                total: results.length,
                valid: results.filter(r => r.status === 'valid').length,
                invalid: results.filter(r => r.status === 'invalid').length,
                catchAll: results.filter(r => r.status === 'catch-all').length,
                unknown: results.filter(r => r.status === 'unknown').length
            };


        return (
            <DashboardLayout
                
                
            >
                <div className="px-4 sm:px-6 lg:px-8 py-8">
                    {/* Header with back button */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleBack}
                                className="flex items-center space-x-1 cursor-pointer"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Email Verifier</span>
                            </Button>

                            {verificationRequestId && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={syncing}
                                    className="flex items-center gap-1.5 cursor-pointer"
                                    onClick={async () => {
                                        try {
                                            setSyncing(true);
                                            const res = await fetch(
                                                `${config.api.baseUrl}/api/verifier/valid-emails/sync/${verificationRequestId}`,
                                                { method: 'POST', credentials: 'include' }
                                            );
                                            const json = await res.json() as { success: boolean; message: string; data?: { synced: number } };
                                            if (json.success) {
                                                toast.success(json.message);
                                            } else {
                                                toast.error(json.message || 'Sync failed');
                                            }
                                        } catch {
                                            toast.error('Sync failed');
                                        } finally {
                                            setSyncing(false);
                                        }
                                    }}
                                >
                                    <DatabaseZap className="h-4 w-4" />
                                    {syncing ? 'Saving…' : 'Save to contacts'}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Results Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left column - Result Analysis */}
                        <div>
                            <ResultAnalysis stats={stats} />
                        </div>

                        {/* Right column - Results List */}
                        <div>
                            <ResultsList
                                results={results}
                                totalCount={stats.total}
                                csvUploadId={csvUploadId}
                                listName={listName}
                                originalFilename={originalFilename}
                            />

                            {/* Infinite scroll trigger element */}
                            {hasMore && (
                                <div
                                    ref={(el) => {
                                        observerTarget.current = el;
                                        setObserverElement(el);
                                    }}
                                    className="py-4"
                                >
                                    {isFetchingMore && (
                                        <div className="flex justify-center items-center space-x-2">
                                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent" />
                                            <span className="text-sm text-gray-600">Loading more results...</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* End of results message */}
                            {!hasMore && results.length > 0 && (
                                <div className="py-4 text-center">
                                    <p className="text-sm text-gray-500">
                                        You've reached the end of the results
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DashboardLayout>
        );

    } catch (error) {
        console.error('VerificationResultsPage render error:', error);

        return (
            <DashboardLayout
                
                
            >
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="text-center space-y-4 p-8">
                        <p className="text-lg font-medium text-gray-900">
                            Failed to load results
                        </p>
                        <p className="text-sm text-gray-600">
                            Unable to display verification results. Please try again.
                        </p>
                        <Button
                            onClick={handleBack}
                            variant="primary"
                            className="cursor-pointer"
                        >
                            Go Back
                        </Button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }
}
