/**
 * Valid Emails Page
 * Shows all verified valid emails grouped by domain
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Globe, AlertCircle, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { validEmailsApi, type ValidEmailEntry, type ValidEmailsDomain } from '../lib/api';
import { toast } from 'react-toastify';

const SOURCE_LABELS: Record<string, string> = {
    single: 'Single',
    csv: 'CSV',
    api: 'API',
};

// Map known provider domains to their root domain for logo lookup
const PROVIDER_ROOT: Record<string, string> = {
    'gmail.com': 'google.com',
    'googlemail.com': 'google.com',
    'outlook.com': 'microsoft.com',
    'hotmail.com': 'microsoft.com',
    'live.com': 'microsoft.com',
    'msn.com': 'microsoft.com',
    'yahoo.com': 'yahoo.com',
    'yahoo.co.uk': 'yahoo.com',
    'icloud.com': 'apple.com',
    'me.com': 'apple.com',
    'mac.com': 'apple.com',
    'protonmail.com': 'proton.me',
    'proton.me': 'proton.me',
    'aol.com': 'aol.com',
    'zoho.com': 'zoho.com',
    'yandex.com': 'yandex.com',
    'yandex.ru': 'yandex.com',
};

function ProviderLogo({ domain }: { domain: string }) {
    const [failed, setFailed] = React.useState(false);
    const root = PROVIDER_ROOT[domain] ?? domain;
    // Google's favicon service — runs in browser, no CORS issues
    const logoUrl = `https://www.google.com/s2/favicons?domain=${root}&sz=32`;

    if (failed) {
        return (
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {domain[0].toUpperCase()}
            </span>
        );
    }

    return (
        <img
            src={logoUrl}
            alt={domain}
            width={20}
            height={20}
            className="rounded-sm flex-shrink-0"
            onError={() => setFailed(true)}
        />
    );
}

export function ValidEmailsPage() {
    const navigate = useNavigate();

    const [domains, setDomains] = React.useState<ValidEmailsDomain[]>([]);
    const [emails, setEmails] = React.useState<ValidEmailEntry[]>([]);
    const [total, setTotal] = React.useState(0);
    const [selectedDomain, setSelectedDomain] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [hasMore, setHasMore] = React.useState(false);
    const PER_PAGE = 50;

    const load = React.useCallback(async (p: number, domain: string | null, reset: boolean) => {
        try {
            if (reset) setLoading(true);
            setError('');

            const data = await validEmailsApi.getValidEmails(p, PER_PAGE, domain);

            setDomains(data.domains);
            setTotal(data.total);
            setHasMore(p * PER_PAGE < data.total);

            setEmails(prev => reset ? data.emails : [...prev, ...data.emails]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load valid emails';
            setError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        setPage(1);
        setEmails([]);
        load(1, selectedDomain, true);
    }, [selectedDomain, load]);

    const handleLoadMore = () => {
        const next = page + 1;
        setPage(next);
        load(next, selectedDomain, false);
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        try {
            const el = e.currentTarget;
            if (el.scrollHeight === 0) return;
            if ((el.scrollTop + el.clientHeight) / el.scrollHeight > 0.85 && hasMore && !loading) {
                handleLoadMore();
            }
        } catch (_) {
            // ignore
        }
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* Header */}
                <div className="mb-8 flex flex-col items-start space-y-4 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/dashboard')}
                        className="flex items-center space-x-1 cursor-pointer"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Valid Emails</h1>
                        <p className="text-gray-600 mt-1">
                            {total > 0 ? `${total.toLocaleString()} valid email${total !== 1 ? 's' : ''} across ${domains.length} domain${domains.length !== 1 ? 's' : ''}` : 'All verified valid email addresses'}
                        </p>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6">
                        <Card className="border-red-200 bg-red-50">
                            <CardContent className="p-4">
                                <div className="flex items-center space-x-2">
                                    <AlertCircle className="h-5 w-5 text-red-600" />
                                    <span className="text-sm text-red-800">{error}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Layout: domains sidebar + emails list */}
                <div className="flex gap-6">

                    {/* Domains sidebar */}
                    <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="w-64 flex-shrink-0"
                    >
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center space-x-2 text-sm">
                                    <Globe className="h-4 w-4 text-[#2F327D]" />
                                    <span>Domains</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="max-h-[600px] overflow-y-auto">
                                    {/* All domains option */}
                                    <button
                                        onClick={() => setSelectedDomain(null)}
                                        className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors cursor-pointer border-b border-gray-100 ${
                                            selectedDomain === null
                                                ? 'bg-indigo-50 text-[#2F327D] font-medium'
                                                : 'text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span>All domains</span>
                                        <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                            {total}
                                        </span>
                                    </button>

                                    {loading && domains.length === 0 ? (
                                        <div className="p-4 space-y-2">
                                            {[1,2,3].map(i => (
                                                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                                            ))}
                                        </div>
                                    ) : domains.length === 0 ? (
                                        <p className="text-xs text-gray-400 p-4">No domains yet</p>
                                    ) : (
                                        domains.map(d => (
                                            <button
                                                key={d.domain}
                                                onClick={() => setSelectedDomain(d.domain)}
                                                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors cursor-pointer border-b border-gray-100 last:border-0 ${
                                                    selectedDomain === d.domain
                                                        ? 'bg-indigo-50 text-[#2F327D] font-medium'
                                                        : 'text-gray-700 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span className="flex items-center space-x-2 min-w-0">
                                                    <ProviderLogo domain={d.domain} />
                                                    <span className="truncate">{d.domain}</span>
                                                </span>
                                                <span className="ml-2 flex-shrink-0 text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                                    {d.count}
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>

                    {/* Emails list */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex-1"
                    >
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center space-x-2">
                                    <Mail className="h-5 w-5 text-[#2F327D]" />
                                    <span>
                                        {selectedDomain ? (
                                            <span className="flex items-center space-x-1">
                                                <span className="text-gray-400">All domains</span>
                                                <ChevronRight className="h-4 w-4 text-gray-400" />
                                                <span>{selectedDomain}</span>
                                            </span>
                                        ) : 'All Emails'}
                                    </span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {loading && emails.length === 0 ? (
                                    <div className="p-4 space-y-2">
                                        {[1,2,3,4,5].map(i => (
                                            <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                                        ))}
                                    </div>
                                ) : emails.length === 0 ? (
                                    <div className="text-center py-16">
                                        <Mail className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                                        <p className="text-gray-500 font-medium">No valid emails yet</p>
                                        <p className="text-sm text-gray-400 mt-1">
                                            Valid emails will appear here after verification
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        className="max-h-[600px] overflow-y-auto"
                                        onScroll={handleScroll}
                                    >
                                        <table className="w-full">
                                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Verified</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {emails.map(entry => (
                                                    <tr key={entry.email} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center space-x-2">
                                                                <ProviderLogo domain={entry.domain} />
                                                                <span className="text-sm font-medium text-gray-900 break-all">{entry.email}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-500">
                                                            {entry.domain}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                                                                {SOURCE_LABELS[entry.source] ?? entry.source}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-500">
                                                            {formatDate(entry.verified_at)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>

                                        {hasMore && (
                                            <div className="text-center py-4 border-t border-gray-100">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={handleLoadMore}
                                                    loading={loading}
                                                    className="cursor-pointer"
                                                >
                                                    Load more
                                                </Button>
                                            </div>
                                        )}

                                        {!hasMore && emails.length > 0 && (
                                            <div className="text-center py-3 border-t border-gray-100">
                                                <p className="text-xs text-gray-400">
                                                    Showing all {emails.length} email{emails.length !== 1 ? 's' : ''}
                                                    {selectedDomain ? ` for ${selectedDomain}` : ''}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
