/**
 * Dashboard page component
 * Main email verifier interface with single and bulk verification
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Users, CheckCircle, TrendingUp, Calendar, Building2, Briefcase, UserCheck, X } from 'lucide-react';
import { DashboardLayout } from '../components/layout';
import { SingleVerifier, BulkVerifier } from '../components/verifier';
import { verificationApi, validEmailsApi, adminApi, type ValidEmailsDomain, type ValidEmailEntry, type PendingUser } from '../lib/api';


// ── Stat tile ──────────────────────────────────────────────────────────────

interface StatTileProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    sub?: string;
    loading: boolean;
    color: string;
}

function StatTile({ icon, label, value, sub, loading, color }: StatTileProps) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                {loading ? (
                    <div className="h-7 w-16 bg-gray-100 rounded-lg animate-pulse" />
                ) : (
                    <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
                )}
                {sub && !loading && (
                    <p className="text-xs text-gray-400 mt-1">{sub}</p>
                )}
            </div>
        </div>
    );
}


// ── Admin: pending user approvals ─────────────────────────────────────────

function PendingUsersPanel() {
    const [pending, setPending] = React.useState<PendingUser[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        adminApi.getPendingUsers()
            .then(users => { if (!cancelled) setPending(users); })
            .catch(() => { /* not admin or network error — hide panel */ })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const approve = async (id: number) => {
        try {
            await adminApi.approveUser(id);
            setPending(prev => prev.filter(u => u.id !== id));
        } catch (_) { /* ignore */ }
    };

    const reject = async (id: number) => {
        try {
            await adminApi.rejectUser(id);
            setPending(prev => prev.filter(u => u.id !== id));
        } catch (_) { /* ignore */ }
    };

    if (loading || pending.length === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4"
        >
            <div className="flex items-center gap-2 mb-3">
                <UserCheck className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                    {pending.length} user{pending.length > 1 ? 's' : ''} waiting for approval
                </p>
            </div>
            <div className="space-y-2">
                {pending.map(u => (
                    <div key={u.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-2.5 border border-amber-100">
                        <span className="text-sm text-gray-700 font-mono truncate">{u.email}</span>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                            <button
                                onClick={() => approve(u.id)}
                                className="px-3 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg cursor-pointer transition-colors"
                            >
                                Approve
                            </button>
                            <button
                                onClick={() => reject(u.id)}
                                className="p-1 text-gray-400 hover:text-red-500 cursor-pointer transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}


// ── Dashboard stats section ────────────────────────────────────────────────

function DashboardStats() {
    const navigate = useNavigate();

    const [loading, setLoading] = React.useState(true);
    const [totalVerified, setTotalVerified] = React.useState(0);
    const [validRate, setValidRate] = React.useState<number | null>(null);
    const [contacts, setContacts] = React.useState(0);
    const [thisMonth, setThisMonth] = React.useState(0);
    const [domains, setDomains] = React.useState<ValidEmailsDomain[]>([]);
    const [titles, setTitles] = React.useState<string[]>([]);

    React.useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const [history, validData] = await Promise.all([
                    verificationApi.getHistory({ per_page: 200, status: 'completed' }),
                    validEmailsApi.getValidEmails(1, 200),
                ]);

                if (cancelled) return;

                // Aggregate stats from history
                const allCompleted = history.requests;
                const total = allCompleted.reduce((s, r) => s + (r.email_count ?? 0), 0);

                // This month: filter by current month
                const startOfMonth = new Date();
                startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
                const monthCount = allCompleted
                    .filter(r => r.created_at * 1000 >= startOfMonth.getTime())
                    .reduce((s, r) => s + (r.email_count ?? 0), 0);

                setTotalVerified(total);
                setThisMonth(monthCount);
                setContacts(validData.total);
                setDomains(validData.domains.slice(0, 6));

                // Derive valid rate from contacts vs total (rough)
                if (total > 0) setValidRate(Math.round((validData.total / total) * 100));

                // Extract unique non-empty job titles from loaded contacts
                const titleSet = new Set<string>();
                (validData.emails as ValidEmailEntry[]).forEach(e => {
                    if (e.job_title?.trim()) titleSet.add(e.job_title.trim());
                });
                setTitles(Array.from(titleSet).slice(0, 20));

            } catch (_) {
                // silently fail — tiles stay at zero
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="space-y-6">

            {/* Stat tiles */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="grid grid-cols-2 lg:grid-cols-4 gap-4"
            >
                <StatTile
                    icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
                    label="Total Verified"
                    value={totalVerified.toLocaleString()}
                    loading={loading}
                    color="bg-indigo-50"
                />
                <StatTile
                    icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
                    label="Valid Rate"
                    value={validRate !== null ? `${validRate}%` : '—'}
                    sub="of verified emails"
                    loading={loading}
                    color="bg-emerald-50"
                />
                <StatTile
                    icon={<Users className="h-5 w-5 text-blue-600" />}
                    label="Contacts Collected"
                    value={contacts.toLocaleString()}
                    loading={loading}
                    color="bg-blue-50"
                />
                <StatTile
                    icon={<Calendar className="h-5 w-5 text-violet-600" />}
                    label="This Month"
                    value={thisMonth.toLocaleString()}
                    sub="emails verified"
                    loading={loading}
                    color="bg-violet-50"
                />
            </motion.div>

            {/* Bottom row: top domains + title filter */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >

                {/* Top domains */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-gray-400" />
                            <p className="text-sm font-semibold text-gray-700">Top Companies</p>
                        </div>
                        <button
                            onClick={() => navigate('/valid-emails')}
                            className="text-xs text-indigo-500 hover:text-indigo-700 cursor-pointer transition-colors"
                        >
                            View all →
                        </button>
                    </div>

                    {loading ? (
                        <div className="space-y-2">
                            {[1,2,3,4].map(i => (
                                <div key={i} className="h-6 bg-gray-100 rounded-lg animate-pulse" />
                            ))}
                        </div>
                    ) : domains.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">No contacts yet</p>
                    ) : (
                        <div className="space-y-1.5">
                            {domains.map(d => {
                                const pct = contacts > 0 ? Math.round((d.count / contacts) * 100) : 0;
                                return (
                                    <button
                                        key={d.domain}
                                        onClick={() => navigate(`/valid-emails?domain=${encodeURIComponent(d.domain)}`)}
                                        className="w-full flex items-center gap-3 group cursor-pointer"
                                    >
                                        <span className="text-sm text-gray-700 w-40 truncate text-left group-hover:text-indigo-600 transition-colors">
                                            {d.domain}
                                        </span>
                                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-400 rounded-full transition-all"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0">{d.count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Job title filter */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-gray-400" />
                            <p className="text-sm font-semibold text-gray-700">Browse by Title</p>
                        </div>
                        <button
                            onClick={() => navigate('/valid-emails')}
                            className="text-xs text-indigo-500 hover:text-indigo-700 cursor-pointer transition-colors"
                        >
                            View all →
                        </button>
                    </div>

                    {loading ? (
                        <div className="flex flex-wrap gap-2">
                            {[1,2,3,4,5,6].map(i => (
                                <div key={i} className="h-7 w-20 bg-gray-100 rounded-full animate-pulse" />
                            ))}
                        </div>
                    ) : titles.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">
                            No title data yet — enrich contacts in the People page
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {titles.map(title => (
                                <button
                                    key={title}
                                    onClick={() => navigate(`/valid-emails?search=${encodeURIComponent(title)}`)}
                                    className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600
                                               hover:bg-indigo-100 hover:text-indigo-700 cursor-pointer transition-colors"
                                >
                                    {title}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

            </motion.div>
        </div>
    );
}


/**
 * Main dashboard page with email verifier
 * @returns DashboardPage JSX element
 */
export function DashboardPage() {
    try {
        const [showSingleVerifier, setShowSingleVerifier] = React.useState(true);
        const [isSingleVerifying, setIsSingleVerifying] = React.useState(false);


        return (
            <DashboardLayout>
                {/* Main Content - Scrollable */}
                <div className="px-4 sm:px-6 lg:px-8 py-8">
                    <div className="w-full max-w-7xl space-y-8 mx-auto">

                        {/* Admin: pending approvals (only visible to admin) */}
                        <PendingUsersPanel />

                        {/* Stats + domain/title widgets */}
                        <DashboardStats />

                        {/* Single Email Verifier - Hidden when in bulk steps */}
                        {showSingleVerifier && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <SingleVerifier
                                    onVerifyingChange={setIsSingleVerifying}
                                />
                            </motion.div>
                        )}

                        {/* Bulk Email Verifier - Hidden when single verifying */}
                        {!isSingleVerifying && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: showSingleVerifier ? 0.2 : 0.1 }}
                            >
                                <BulkVerifier
                                    maxFileSizeMB={100}
                                    onStepChange={setShowSingleVerifier}
                                />
                            </motion.div>
                        )}
                    </div>
                </div>
            </DashboardLayout>
        );

    } catch (error) {
        console.error('DashboardPage render error:', error);

        return (
            <DashboardLayout>
                <div className="text-center space-y-4 py-12">
                    <p className="text-lg font-medium text-gray-900">
                        Something went wrong
                    </p>
                    <p className="text-sm text-gray-600">
                        Unable to load the dashboard. Please try refreshing the page.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600
                                 transition-colors cursor-pointer"
                    >
                        Refresh Page
                    </button>
                </div>
            </DashboardLayout>
        );
    }
}