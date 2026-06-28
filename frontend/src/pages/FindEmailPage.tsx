/**
 * Find Email Page — single search + bulk CSV mode
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Search, CheckCircle2, XCircle, HelpCircle,
    AlertCircle, Loader2, Copy, Check, Mail, Upload, Download,
    Clock, Pause
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { config } from '../data/env';
import { toast } from 'react-toastify';


// ── Types ──────────────────────────────────────────────────────────────────

type SearchState = 'idle' | 'searching' | 'done';
type PageMode    = 'single' | 'bulk';

interface Attempt {
    email:   string;
    status:  string;
    reason:  string;
    pattern: string;
}

interface BulkRow {
    firstName: string;
    lastName:  string;
    domain:    string;
}

type BulkStatus = 'waiting' | 'running' | 'found' | 'not_found' | 'blocked';

interface BulkResult {
    row:        BulkRow;
    status:     BulkStatus;
    email:      string;
    reason:     string;
    /** current pattern being tested (live) */
    trying:     string;
    attempts:   number;
}

const TOTAL_PATTERNS = 26;


// ── Small shared components ────────────────────────────────────────────────

function StatusIcon({ status, size = 4 }: { status: string; size?: number }) {
    const cls = `h-${size} w-${size} flex-shrink-0`;
    switch (status) {
        case 'valid':     return <CheckCircle2 className={`${cls} text-green-500`} />;
        case 'invalid':   return <XCircle      className={`${cls} text-red-400`} />;
        case 'catch-all': return <AlertCircle  className={`${cls} text-orange-400`} />;
        default:          return <HelpCircle   className={`${cls} text-gray-400`} />;
    }
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        valid:       'bg-green-100 text-green-700 border-green-200',
        invalid:     'bg-red-50 text-red-500 border-red-100',
        'catch-all': 'bg-orange-50 text-orange-600 border-orange-100',
        unknown:     'bg-gray-50 text-gray-400 border-gray-100',
    };
    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${map[status] ?? map.unknown}`}>
            {status}
        </span>
    );
}

function BulkStatusIcon({ status }: { status: BulkStatus }) {
    switch (status) {
        case 'found':     return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />;
        case 'not_found': return <XCircle      className="h-4 w-4 text-red-400 flex-shrink-0" />;
        case 'blocked':   return <AlertCircle  className="h-4 w-4 text-orange-400 flex-shrink-0" />;
        case 'running':   return <Loader2      className="h-4 w-4 text-[#2F327D] animate-spin flex-shrink-0" />;
        case 'waiting':   return <Pause        className="h-4 w-4 text-gray-300 flex-shrink-0" />;
    }
}


// ── CSV helpers ────────────────────────────────────────────────────────────

/**
 * Parse CSV text into BulkRow[]. Accepts header row with firstName/lastName/domain
 * (case-insensitive, with/without spaces). Also handles first_name / last_name variants.
 */
function parseCSV(text: string): BulkRow[] {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h =>
        h.trim().toLowerCase().replace(/[\s_-]/g, '')
    );

    const fnIdx  = headers.findIndex(h => h === 'firstname'  || h === 'first');
    const lnIdx  = headers.findIndex(h => h === 'lastname'   || h === 'last');
    const domIdx = headers.findIndex(h => h === 'domain'     || h === 'company' || h === 'website');

    if (fnIdx === -1 || lnIdx === -1 || domIdx === -1) return [];

    const rows: BulkRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const fn  = cols[fnIdx]  || '';
        const ln  = cols[lnIdx]  || '';
        const dom = cols[domIdx] || '';
        if (fn && ln && dom) rows.push({ firstName: fn, lastName: ln, domain: dom });
    }
    return rows;
}

function exportCSV(results: BulkResult[]): void {
    const header = 'firstName,lastName,domain,email,status,reason';
    const rows = results.map(r =>
        [r.row.firstName, r.row.lastName, r.row.domain,
         r.email, r.status, `"${r.reason.replace(/"/g, "'")}"`].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `find-email-results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}


// ── Main component ─────────────────────────────────────────────────────────

export function FindEmailPage() {
    const navigate = useNavigate();

    // Mode
    const [pageMode, setPageMode] = React.useState<PageMode>('single');

    // ── Single mode state ──
    const [firstName, setFirstName] = React.useState('');
    const [lastName,  setLastName]  = React.useState('');
    const [domain,    setDomain]    = React.useState('');

    const [searchState,     setSearchState]     = React.useState<SearchState>('idle');
    const [attempts,        setAttempts]        = React.useState<Attempt[]>([]);
    const [foundEmail,      setFoundEmail]      = React.useState<Attempt | null>(null);
    const [copied,          setCopied]          = React.useState(false);
    const [blockedMsg,      setBlockedMsg]      = React.useState<string>('');
    const [providerProfile, setProviderProfile] = React.useState<string>('');
    const [infoMsg,         setInfoMsg]         = React.useState<string>('');

    const esRef      = React.useRef<EventSource | null>(null);
    const listEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [attempts]);
    React.useEffect(() => () => { esRef.current?.close(); }, []);

    // ── Bulk mode state ──
    const [bulkRows,      setBulkRows]      = React.useState<BulkRow[]>([]);
    const [bulkResults,   setBulkResults]   = React.useState<BulkResult[]>([]);
    const [bulkRunning,   setBulkRunning]   = React.useState(false);
    const [bulkDone,      setBulkDone]      = React.useState(false);
    const [bulkCurrent,   setBulkCurrent]   = React.useState(-1);
    const bulkStopRef     = React.useRef(false);
    const bulkEsRef       = React.useRef<EventSource | null>(null);
    const fileInputRef    = React.useRef<HTMLInputElement>(null);


    // ── Populate from URL params (coming from ProspectPage) ───────────────
    React.useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        if (p.get('firstName')) setFirstName(p.get('firstName')!);
        if (p.get('lastName'))  setLastName(p.get('lastName')!);
        if (p.get('domain'))    setDomain(p.get('domain')!);
    }, []);


    // ── Single mode handlers ───────────────────────────────────────────────

    const handleSubmit = (e: React.FormEvent) => {
        try {
            e.preventDefault();
            if (!firstName.trim() || !lastName.trim() || !domain.trim()) {
                toast.error('All fields are required');
                return;
            }

            esRef.current?.close();
            setSearchState('searching');
            setAttempts([]);
            setFoundEmail(null);
            setInfoMsg('');
            setBlockedMsg('');

            const params = new URLSearchParams({
                firstName: firstName.trim(),
                lastName:  lastName.trim(),
                domain:    domain.trim().replace(/^@/, ''),
            });

            const base = config.api.baseUrl || '';
            const es   = new EventSource(`${base}/api/verifier/find-email?${params}`, { withCredentials: true });
            esRef.current = es;

            es.addEventListener('config', (e) => {
                try {
                    const d = JSON.parse((e as MessageEvent).data ?? '{}');
                    if (d.profile) setProviderProfile(d.profile);
                } catch (_) { /* ignore */ }
            });

            es.addEventListener('info', (e) => {
                try {
                    const d = JSON.parse((e as MessageEvent).data ?? '{}');
                    if (d.message) setInfoMsg(d.message);
                } catch (_) { /* ignore */ }
            });

            es.addEventListener('attempt', (e) => {
                const a: Attempt = JSON.parse(e.data);
                setAttempts(prev => [...prev, a]);
            });

            es.addEventListener('found', (e) => {
                setFoundEmail(JSON.parse(e.data));
                setSearchState('done');
                es.close();
            });

            es.addEventListener('done', (e) => {
                try {
                    const d = JSON.parse((e as MessageEvent).data ?? '{}');
                    if (d.blocked) setBlockedMsg(d.message ?? 'Mail server rate-limited this search.');
                } catch (_) { /* no data */ }
                setSearchState('done');
                es.close();
            });

            es.addEventListener('error', () => {
                setSearchState('done');
                es.close();
            });

            es.onerror = () => {
                if (es.readyState !== EventSource.CLOSED) {
                    setSearchState('done');
                    es.close();
                }
            };
        } catch (err) {
            setSearchState('idle');
            toast.error(err instanceof Error ? err.message : 'Search failed');
        }
    };

    const handleStop = () => { esRef.current?.close(); setSearchState('done'); };

    const handleReset = () => {
        esRef.current?.close();
        setSearchState('idle');
        setAttempts([]);
        setFoundEmail(null);
        setBlockedMsg('');
        setProviderProfile('');
        setInfoMsg('');
    };

    const handleCopy = async (email: string) => {
        try {
            await navigator.clipboard.writeText(email);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast.success('Copied!');
        } catch (_) { toast.error('Failed to copy'); }
    };


    // ── Bulk mode handlers ─────────────────────────────────────────────────

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target?.result as string;
                    const rows = parseCSV(text);
                    if (rows.length === 0) {
                        toast.error('No valid rows found. CSV must have columns: firstName, lastName, domain');
                        return;
                    }
                    setBulkRows(rows);
                    setBulkResults([]);
                    setBulkDone(false);
                    toast.success(`Loaded ${rows.length} contacts`);
                } catch (err) {
                    toast.error('Failed to parse CSV');
                }
            };
            reader.readAsText(file);
        } catch (err) {
            toast.error('Failed to read file');
        } finally {
            // reset so same file can be re-uploaded
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };


    /**
     * Run find-email SSE for a single row, returns the result when done
     */
    const runSingleSSE = (row: BulkRow, idx: number): Promise<void> => {
        return new Promise((resolve) => {
            try {
                const params = new URLSearchParams({
                    firstName: row.firstName.trim(),
                    lastName:  row.lastName.trim(),
                    domain:    row.domain.trim().replace(/^@/, ''),
                });

                const base = config.api.baseUrl || '';
                const es   = new EventSource(`${base}/api/verifier/find-email?${params}`, { withCredentials: true });
                bulkEsRef.current = es;

                let attemptCount = 0;

                const done = (status: BulkStatus, email = '', reason = '') => {
                    es.close();
                    setBulkResults(prev => prev.map((r, i) =>
                        i === idx ? { ...r, status, email, reason, trying: '' } : r
                    ));
                    resolve();
                };

                es.addEventListener('attempt', (e) => {
                    if (bulkStopRef.current) { done('not_found'); return; }
                    try {
                        const a: Attempt = JSON.parse(e.data);
                        attemptCount++;
                        setBulkResults(prev => prev.map((r, i) =>
                            i === idx ? { ...r, trying: a.email, attempts: attemptCount } : r
                        ));
                    } catch (_) { /* ignore */ }
                });

                es.addEventListener('found', (e) => {
                    try {
                        const a: Attempt = JSON.parse(e.data);
                        done('found', a.email, a.reason);
                    } catch (_) { done('found'); }
                });

                es.addEventListener('done', (e) => {
                    try {
                        const d = JSON.parse((e as MessageEvent).data ?? '{}');
                        done(d.blocked ? 'blocked' : 'not_found', '', d.message ?? '');
                    } catch (_) { done('not_found'); }
                });

                es.addEventListener('error', () => done('not_found'));
                es.onerror = () => { if (es.readyState !== EventSource.CLOSED) done('not_found'); };
            } catch (err) {
                // resolve so bulk queue continues
                resolve();
            }
        });
    };


    const handleBulkStart = async () => {
        try {
            if (bulkRows.length === 0) { toast.error('Upload a CSV first'); return; }

            bulkStopRef.current = false;
            setBulkRunning(true);
            setBulkDone(false);
            setBulkCurrent(0);

            // Init all rows as waiting
            const initial: BulkResult[] = bulkRows.map(row => ({
                row, status: 'waiting', email: '', reason: '', trying: '', attempts: 0,
            }));
            setBulkResults(initial);

            for (let i = 0; i < bulkRows.length; i++) {
                if (bulkStopRef.current) break;

                setBulkCurrent(i);
                // Mark as running
                setBulkResults(prev => prev.map((r, idx) =>
                    idx === i ? { ...r, status: 'running' } : r
                ));

                await runSingleSSE(bulkRows[i], i);
            }
        } catch (err) {
            toast.error('Bulk run failed');
        } finally {
            setBulkRunning(false);
            setBulkDone(true);
            setBulkCurrent(-1);
        }
    };

    const handleBulkStop = () => {
        bulkStopRef.current = true;
        bulkEsRef.current?.close();
        setBulkRunning(false);
        setBulkDone(true);
        setBulkCurrent(-1);
    };

    const handleBulkReset = () => {
        bulkStopRef.current = true;
        bulkEsRef.current?.close();
        setBulkRows([]);
        setBulkResults([]);
        setBulkRunning(false);
        setBulkDone(false);
        setBulkCurrent(-1);
    };


    // ── Derived ────────────────────────────────────────────────────────────

    const progress   = Math.round((attempts.length / TOTAL_PATTERNS) * 100);
    const isSearching = searchState === 'searching';
    const isDone      = searchState === 'done';
    const hasResults  = attempts.length > 0 || isSearching;

    const bulkCompleted = bulkResults.filter(r => r.status !== 'waiting' && r.status !== 'running').length;
    const bulkFound     = bulkResults.filter(r => r.status === 'found');
    const bulkProgress  = bulkResults.length > 0
        ? Math.round((bulkCompleted / bulkResults.length) * 100)
        : 0;


    // ── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* Header */}
                <div className="mb-8 flex items-center space-x-4">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}
                        className="flex items-center space-x-1 cursor-pointer">
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Find Email</h1>
                        <p className="text-sm text-gray-500 mt-0.5">Discover work emails by name + domain</p>
                    </div>
                </div>

                {/* Mode tabs */}
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 w-fit">
                    <button
                        onClick={() => setPageMode('single')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            pageMode === 'single' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Search className="h-4 w-4" />
                        Single
                    </button>
                    <button
                        onClick={() => setPageMode('bulk')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            pageMode === 'bulk' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Upload className="h-4 w-4" />
                        Bulk CSV
                    </button>
                </div>


                {/* ── SINGLE MODE ── */}
                {pageMode === 'single' && (
                    <>
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                            <Card>
                                <CardContent className="p-6">
                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">First Name</label>
                                                <input type="text" value={firstName}
                                                    onChange={e => setFirstName(e.target.value)}
                                                    placeholder="John" disabled={isSearching}
                                                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Last Name</label>
                                                <input type="text" value={lastName}
                                                    onChange={e => setLastName(e.target.value)}
                                                    placeholder="Doe" disabled={isSearching}
                                                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Company Domain</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                                                <input type="text" value={domain}
                                                    onChange={e => setDomain(e.target.value)}
                                                    placeholder="company.com" disabled={isSearching}
                                                    className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2 pt-1">
                                            <Button type="submit" variant="primary"
                                                disabled={isSearching} loading={isSearching}
                                                className="cursor-pointer">
                                                <Search className="h-4 w-4 mr-2" />
                                                {isSearching ? 'Searching...' : 'Find Email'}
                                            </Button>
                                            {isSearching && (
                                                <Button type="button" variant="ghost" onClick={handleStop}
                                                    className="cursor-pointer text-gray-500">
                                                    Stop
                                                </Button>
                                            )}
                                            {isDone && (
                                                <Button type="button" variant="ghost" onClick={handleReset}
                                                    className="cursor-pointer">
                                                    New search
                                                </Button>
                                            )}
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                        </motion.div>

                        <AnimatePresence>
                            {hasResults && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-5 space-y-3"
                                >
                                    {foundEmail && (
                                        <motion.div
                                            initial={{ scale: 0.97, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                                        >
                                            <Card className="border-green-300 shadow-sm shadow-green-100">
                                                <CardContent className="p-5">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center space-x-4">
                                                            <div className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                                                <Mail className="h-5 w-5 text-green-600" />
                                                            </div>
                                                            <div>
                                                                <p className="text-[11px] font-semibold text-green-600 uppercase tracking-widest mb-0.5">Email found</p>
                                                                <p className="text-base font-semibold text-gray-900 font-mono">{foundEmail.email}</p>
                                                                <p className="text-xs text-green-700 mt-0.5">{foundEmail.reason}</p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleCopy(foundEmail.email)}
                                                            className="p-2 rounded-lg hover:bg-green-100 transition-colors cursor-pointer text-gray-500 hover:text-green-700"
                                                        >
                                                            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </motion.div>
                                    )}

                                    {isDone && !foundEmail && blockedMsg && (
                                        <Card className="border-orange-200 bg-orange-50">
                                            <CardContent className="p-4 flex items-center space-x-3">
                                                <AlertCircle className="h-5 w-5 text-orange-500 flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-orange-800">Mail server blocked the search</p>
                                                    <p className="text-xs text-orange-600 mt-0.5">{blockedMsg}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {isDone && !foundEmail && !blockedMsg && (
                                        <Card className="border-gray-200">
                                            <CardContent className="p-4 flex items-center space-x-3">
                                                <XCircle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-700">No valid email found</p>
                                                    <p className="text-xs text-gray-400 mt-0.5">Tried {attempts.length} patterns — none exist on this domain</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}

                                    <Card>
                                        <CardContent className="p-0">
                                            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium text-gray-700">
                                                        {isSearching ? 'Checking patterns...' : `${attempts.length} patterns checked`}
                                                    </span>
                                                    <span className="text-xs text-gray-400">{attempts.length} / {TOTAL_PATTERNS}</span>
                                                </div>
                                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                    <motion.div
                                                        className={`h-full rounded-full ${foundEmail ? 'bg-green-500' : 'bg-[#2F327D]'}`}
                                                        initial={{ width: 0 }}
                                                        animate={{ width: isDone ? '100%' : `${progress}%` }}
                                                        transition={{ duration: 0.3 }}
                                                    />
                                                </div>
                                                {isSearching && (
                                                    <div className="flex items-center justify-between mt-2">
                                                        <div className="flex items-center space-x-1.5">
                                                            <Loader2 className="h-3 w-3 text-[#2F327D] animate-spin" />
                                                            <span className="text-xs text-gray-400">
                                                                Testing{' '}
                                                                <span className="font-mono text-[#2F327D]">
                                                                    {attempts.length > 0 ? `pattern ${attempts.length + 1}` : 'first pattern'}
                                                                </span>
                                                            </span>
                                                        </div>
                                                        {providerProfile && (
                                                            <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[160px]">
                                                                {providerProfile}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {infoMsg && (
                                                <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-b border-gray-100 flex items-center space-x-1.5">
                                                    <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                                                    <span>{infoMsg}</span>
                                                </div>
                                            )}

                                            <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                                                {attempts.map((attempt) => (
                                                    <motion.div
                                                        key={attempt.email}
                                                        initial={{ opacity: 0, y: -4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ duration: 0.15 }}
                                                        className={`flex items-center justify-between px-4 py-2.5 ${attempt.status === 'valid' ? 'bg-green-50' : ''}`}
                                                    >
                                                        <div className="flex items-center space-x-3 min-w-0">
                                                            <StatusIcon status={attempt.status} size={4} />
                                                            <span className="text-sm font-mono text-gray-800 truncate">{attempt.email}</span>
                                                        </div>
                                                        <StatusBadge status={attempt.status} />
                                                    </motion.div>
                                                ))}
                                                {isSearching && (
                                                    <div className="flex items-center space-x-3 px-4 py-2.5 opacity-40">
                                                        <Loader2 className="h-4 w-4 text-gray-400 animate-spin flex-shrink-0" />
                                                        <span className="text-sm font-mono text-gray-400 animate-pulse">checking...</span>
                                                    </div>
                                                )}
                                                <div ref={listEndRef} />
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                )}


                {/* ── BULK MODE ── */}
                {pageMode === 'bulk' && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

                        {/* Upload card */}
                        <Card>
                            <CardContent className="p-6">
                                <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Upload CSV</p>
                                <p className="text-xs text-gray-400 mb-4">
                                    Required columns: <span className="font-mono text-gray-600">firstName, lastName, domain</span>
                                    <br />
                                    Example: <span className="font-mono text-gray-500">Ion,Popescu,acme.ro</span>
                                </p>

                                <div className="flex items-center gap-3">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv,text/csv"
                                        onChange={handleFileChange}
                                        className="hidden"
                                        id="csv-upload"
                                    />
                                    <label
                                        htmlFor="csv-upload"
                                        className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 hover:border-[#2F327D] hover:text-[#2F327D] transition-colors"
                                    >
                                        <Upload className="h-4 w-4" />
                                        {bulkRows.length > 0 ? `${bulkRows.length} contacts loaded — replace` : 'Choose CSV file'}
                                    </label>

                                    {bulkRows.length > 0 && !bulkRunning && (
                                        <Button
                                            variant="primary"
                                            onClick={handleBulkStart}
                                            className="cursor-pointer"
                                        >
                                            <Search className="h-4 w-4 mr-2" />
                                            Start ({bulkRows.length})
                                        </Button>
                                    )}

                                    {bulkRunning && (
                                        <Button variant="ghost" onClick={handleBulkStop} className="cursor-pointer text-red-500 hover:text-red-600">
                                            Stop
                                        </Button>
                                    )}

                                    {bulkDone && bulkResults.length > 0 && (
                                        <>
                                            <Button variant="ghost" onClick={() => exportCSV(bulkResults)} className="cursor-pointer flex items-center gap-1.5 text-gray-600">
                                                <Download className="h-4 w-4" />
                                                Export CSV
                                            </Button>
                                            <Button variant="ghost" onClick={handleBulkReset} className="cursor-pointer text-gray-400">
                                                Reset
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </CardContent>
                        </Card>


                        {/* Progress overview */}
                        {bulkResults.length > 0 && (
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-700">
                                            {bulkRunning
                                                ? `Processing ${bulkCurrent + 1} / ${bulkResults.length}...`
                                                : bulkDone
                                                    ? `Done — ${bulkFound.length} email${bulkFound.length !== 1 ? 's' : ''} found`
                                                    : 'Ready'}
                                        </span>
                                        <span className="text-xs text-gray-400">{bulkCompleted} / {bulkResults.length}</span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <motion.div
                                            className={`h-full rounded-full ${bulkDone ? 'bg-green-500' : 'bg-[#2F327D]'}`}
                                            animate={{ width: `${bulkProgress}%` }}
                                            transition={{ duration: 0.3 }}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        )}


                        {/* Bulk results list */}
                        {bulkResults.length > 0 && (
                            <Card>
                                <CardContent className="p-0">
                                    <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                                        {bulkResults.map((r, i) => (
                                            <motion.div
                                                key={i}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                className={`flex items-center gap-3 px-4 py-3 ${r.status === 'found' ? 'bg-green-50' : ''}`}
                                            >
                                                <BulkStatusIcon status={r.status} />

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-gray-800 truncate">
                                                            {r.row.firstName} {r.row.lastName}
                                                        </span>
                                                        <span className="text-xs text-gray-400 font-mono truncate">@{r.row.domain}</span>
                                                    </div>

                                                    {r.status === 'found' && (
                                                        <p className="text-xs font-mono text-green-700 mt-0.5">{r.email}</p>
                                                    )}
                                                    {r.status === 'running' && r.trying && (
                                                        <p className="text-xs text-gray-400 font-mono mt-0.5 animate-pulse">
                                                            trying {r.trying} ({r.attempts}/{TOTAL_PATTERNS})
                                                        </p>
                                                    )}
                                                    {r.status === 'blocked' && (
                                                        <p className="text-xs text-orange-500 mt-0.5">Server blocked — skipped</p>
                                                    )}
                                                    {r.status === 'not_found' && (
                                                        <p className="text-xs text-gray-400 mt-0.5">No email found after {r.attempts} patterns</p>
                                                    )}
                                                    {r.status === 'waiting' && (
                                                        <p className="text-xs text-gray-300 mt-0.5 flex items-center gap-1">
                                                            <Clock className="h-3 w-3" /> Waiting...
                                                        </p>
                                                    )}
                                                </div>

                                                {r.status === 'found' && (
                                                    <button
                                                        onClick={() => handleCopy(r.email)}
                                                        className="p-1.5 rounded hover:bg-green-100 transition-colors cursor-pointer text-gray-400 hover:text-green-700 flex-shrink-0"
                                                        title="Copy email"
                                                    >
                                                        <Copy className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </motion.div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                    </motion.div>
                )}

            </div>
        </div>
    );
}
