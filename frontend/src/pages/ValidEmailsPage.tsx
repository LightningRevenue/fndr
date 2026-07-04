/**
 * Valid Emails Page — Clay.com style with slide-in contact panel
 */

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, Search, X, Copy, Check,
    Linkedin, Phone, MapPin, Building2, Briefcase,
    Smartphone, Tag, FileText, Plus, Download, Users,
    AlertCircle, ChevronDown,
} from 'lucide-react';
import { validEmailsApi, type ValidEmailEntry, type ValidEmailsDomain } from '../lib/api';
import { toast } from 'react-toastify';


// ── Role categorisation ────────────────────────────────────────────────────

const ROLE_CATEGORIES = [
    { key: 'executive',  label: 'Executive',   keywords: ['ceo','cto','cfo','coo','cpo','chief','president','founder','co-founder','owner','director','vp','vice president','managing director','md','general manager','gm','partner'] },
    { key: 'sales',      label: 'Sales',       keywords: ['sales','account manager','account executive','business development','bdm','bde','bd manager','commercial','telesales','area sales','regional sales','national sales','key account','ka manager','territory'] },
    { key: 'management', label: 'Management',  keywords: ['manager','head of','lead','supervisor','team lead','coordinator','zonal','area manager','regional manager'] },
    { key: 'marketing',  label: 'Marketing',   keywords: ['marketing','brand','content','seo','sem','social media','growth','campaign','digital','communications','pr ','public relations','copywriter','creative director'] },
    { key: 'it',         label: 'IT / Tech',   keywords: ['engineer','developer','devops','architect','it ','data','database','software','backend','frontend','fullstack','full stack','qa','tester','sysadmin','network','cyber','security','cloud','ml','ai ','machine learning','dba','sap','erp'] },
    { key: 'finance',    label: 'Finance',     keywords: ['finance','financial','accountant','accounting','controller','treasurer','audit','tax','credit','investment','analyst','risk','compliance','budget','payroll','cfp','cpa'] },
    { key: 'hr',         label: 'HR',          keywords: ['hr ','human resources','recruiter','recruitment','talent','people','hrbp','hr business','learning','l&d','training','payroll','workforce'] },
    { key: 'operations', label: 'Operations',  keywords: ['operations','supply chain','logistics','procurement','purchasing','warehouse','production','manufacturing','quality','process','project manager','program manager','pmo','delivery'] },
    { key: 'design',     label: 'Design / UX', keywords: ['design','designer','ux','ui ','user experience','user interface','product design','visual','graphic','illustrat','motion','brand design'] },
    { key: 'legal',      label: 'Legal',       keywords: ['legal','counsel','lawyer','attorney','compliance','gdpr','contract','paralegal','judicial'] },
] as const;

type RoleCategory = (typeof ROLE_CATEGORIES)[number]['key'] | 'other';

function classifyRole(title: string | null): RoleCategory {
    if (!title) return 'other';
    const t = title.toLowerCase();
    for (const cat of ROLE_CATEGORIES) {
        if (cat.keywords.some(kw => t.includes(kw))) return cat.key;
    }
    return 'other';
}


// ── Constants ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-orange-500',
    'bg-pink-500',   'bg-cyan-500',  'bg-amber-500',   'bg-rose-500',
];

function avatarColor(email: string) {
    let n = 0;
    for (let i = 0; i < email.length; i++) n += email.charCodeAt(i);
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

const PROVIDER_ROOT: Record<string, string> = {
    'gmail.com': 'google.com',      'googlemail.com': 'google.com',
    'outlook.com': 'microsoft.com', 'hotmail.com': 'microsoft.com',
    'live.com': 'microsoft.com',    'msn.com': 'microsoft.com',
    'yahoo.com': 'yahoo.com',       'icloud.com': 'apple.com',
    'me.com': 'apple.com',          'mac.com': 'apple.com',
    'protonmail.com': 'proton.me',  'proton.me': 'proton.me',
};

const SOURCE_PILL: Record<string, { label: string; cls: string }> = {
    single: { label: 'Single', cls: 'bg-blue-100 text-blue-700' },
    csv:    { label: 'CSV',    cls: 'bg-purple-100 text-purple-700' },
    api:    { label: 'API',    cls: 'bg-teal-100 text-teal-700' },
};

const COL_HEADERS = [
    { key: 'name',     label: 'Name',       icon: <Users     className="h-3.5 w-3.5" /> },
    { key: 'email',    label: 'Work Email', icon: <Briefcase className="h-3.5 w-3.5" /> },
    { key: 'company',  label: 'Company',    icon: <Building2 className="h-3.5 w-3.5" /> },
    { key: 'phone',    label: 'Phone',      icon: <Phone     className="h-3.5 w-3.5" /> },
    { key: 'location', label: 'Location',   icon: <MapPin    className="h-3.5 w-3.5" /> },
    { key: 'source',   label: 'Source',     icon: <Tag       className="h-3.5 w-3.5" /> },
] as const;


// ── Sub-components ─────────────────────────────────────────────────────────

function FaviconImg({ domain }: { domain: string }) {
    const [failed, setFailed] = React.useState(false);
    const root = PROVIDER_ROOT[domain] ?? domain;
    if (failed) {
        return (
            <span className="w-5 h-5 rounded-full bg-gray-100 border border-gray-200 text-gray-500 text-[9px] font-bold flex items-center justify-center flex-shrink-0 select-none">
                {domain[0].toUpperCase()}
            </span>
        );
    }
    return (
        <img
            src={`https://www.google.com/s2/favicons?domain=${root}&sz=32`}
            alt="" width={18} height={18}
            className="rounded-full flex-shrink-0"
            onError={() => setFailed(true)}
        />
    );
}

function Avatar({ entry }: { entry: ValidEmailEntry }) {
    const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
    const initials = ((entry.first_name?.[0] ?? '') + (entry.last_name?.[0] ?? '')).toUpperCase();
    const color = avatarColor(entry.email);
    return (
        <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center flex-shrink-0 select-none shadow-sm`}>
            <span className="text-[11px] font-semibold text-white">
                {initials || name.slice(0, 2).toUpperCase() || entry.email[0].toUpperCase()}
            </span>
        </div>
    );
}

function CopyBtn({ value }: { value: string }) {
    const [done, setDone] = React.useState(false);
    const handle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
        toast.success('Copied!', { autoClose: 1000 });
    };
    return (
        <button
            onClick={handle}
            className="opacity-0 group-hover:opacity-100 ml-1 p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-all cursor-pointer flex-shrink-0"
        >
            {done ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}


// ── Inline editable field ──────────────────────────────────────────────────

function InlineField({ value, placeholder, icon, onSave, type = 'text' }: {
    value: string | null;
    placeholder: string;
    icon: React.ReactNode;
    onSave: (v: string) => Promise<void>;
    type?: string;
}) {
    const [editing, setEditing] = React.useState(false);
    const [input,   setInput]   = React.useState(value ?? '');
    const [saving,  setSaving]  = React.useState(false);

    const commit = async () => {
        try {
            setSaving(true);
            await onSave(input.trim());
            setEditing(false);
        } catch (_) {
            toast.error('Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <div className="flex items-center gap-1.5 w-full">
                <span className="flex-shrink-0 text-gray-400">{icon}</span>
                <input
                    autoFocus type={type} value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={placeholder}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setInput(value ?? ''); setEditing(false); } }}
                    className="flex-1 min-w-0 text-sm px-2 py-0.5 border border-indigo-400 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300/40 font-mono bg-white shadow-sm"
                />
                <button onClick={commit} disabled={saving} className="p-1 rounded-md hover:bg-emerald-50 text-emerald-600 cursor-pointer disabled:opacity-40">
                    <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => { setInput(value ?? ''); setEditing(false); }} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 cursor-pointer">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => setEditing(true)}
            className={`flex items-center gap-2 w-full text-left text-sm group/field cursor-pointer rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 transition-colors ${value ? 'text-gray-700' : 'text-gray-300 hover:text-gray-500'}`}
        >
            <span className="flex-shrink-0 opacity-50">{icon}</span>
            <span className={`truncate ${!value ? 'italic text-xs' : ''}`}>{value || placeholder}</span>
            {!value && <Plus className="h-3 w-3 opacity-0 group-hover/field:opacity-40 flex-shrink-0 ml-auto" />}
        </button>
    );
}


// ── Right-side contact panel ───────────────────────────────────────────────

function ContactPanel({ entry, onClose, onUpdate }: {
    entry: ValidEmailEntry;
    onClose: () => void;
    onUpdate: (email: string, fields: Partial<ValidEmailEntry>) => Promise<void>;
}) {
    const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
    const save = (field: keyof ValidEmailEntry) => async (val: string) =>
        onUpdate(entry.email, { [field]: val || null });

    // Close on Escape
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <>
            {/* Mobile overlay */}
            <div
                className="fixed inset-0 bg-black/20 z-30 sm:hidden"
                onClick={onClose}
            />

            {/* Slide-in panel */}
            <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed top-0 right-0 bottom-0 w-[380px] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
            >
                {/* Panel header */}
                <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <Avatar entry={entry} />
                        <div className="min-w-0">
                            <p className={`text-sm font-semibold leading-snug truncate ${name ? 'text-gray-900' : 'text-gray-400 italic font-normal'}`}>
                                {name || 'No name'}
                            </p>
                            {entry.job_title && (
                                <p className="text-xs text-gray-500 truncate leading-tight mt-0.5">{entry.job_title}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer transition-colors flex-shrink-0 ml-2"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Scrollable fields */}
                <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1.5">
                    {/* Work email is read-only (it's the primary key) */}
                    <div className="flex items-center gap-2 group/cell px-1 py-0.5">
                        <span className="flex-shrink-0 opacity-50"><Briefcase className="h-3.5 w-3.5" /></span>
                        <span className="text-sm text-gray-700 font-mono truncate flex-1">{entry.email}</span>
                        <CopyBtn value={entry.email} />
                    </div>
                    <InlineField value={entry.personal_email} placeholder="Personal email" icon={<Smartphone className="h-3.5 w-3.5" />} onSave={save('personal_email')} type="email" />
                    <InlineField value={entry.phone}          placeholder="Phone"          icon={<Phone      className="h-3.5 w-3.5" />} onSave={save('phone')}          type="tel" />
                    <InlineField value={entry.job_title}      placeholder="Job title"      icon={<Briefcase  className="h-3.5 w-3.5" />} onSave={save('job_title')} />
                    <InlineField value={entry.company_name}   placeholder="Company name"   icon={<Building2  className="h-3.5 w-3.5" />} onSave={save('company_name')} />
                    <InlineField value={entry.linkedin_url}   placeholder="LinkedIn URL"   icon={<Linkedin   className="h-3.5 w-3.5" />} onSave={save('linkedin_url')}   type="url" />
                    <InlineField value={entry.city}           placeholder="City"           icon={<MapPin     className="h-3.5 w-3.5" />} onSave={save('city')} />
                    <InlineField value={entry.country}        placeholder="Country"        icon={<MapPin     className="h-3.5 w-3.5" />} onSave={save('country')} />
                    <InlineField value={entry.tags}           placeholder="Tags"           icon={<Tag        className="h-3.5 w-3.5" />} onSave={save('tags')} />
                    <InlineField value={entry.notes}          placeholder="Notes"          icon={<FileText   className="h-3.5 w-3.5" />} onSave={save('notes')} />
                </div>
            </motion.div>
        </>
    );
}


// ── Collapsible sidebar section ───────────────────────────────────────────

function SidebarSection({ label, defaultOpen, children }: {
    label: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = React.useState(defaultOpen ?? true);
    return (
        <div className="mb-1">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer transition-colors group"
            >
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-gray-500">
                    {label}
                </span>
                <ChevronDown className={`h-3 w-3 text-gray-300 transition-transform ${open ? '' : '-rotate-90'}`} />
            </button>
            {open && <div className="mt-0.5">{children}</div>}
        </div>
    );
}


// ── Sidebar domain item ────────────────────────────────────────────────────

function DomainItem({ d, selected, onClick }: { d: ValidEmailsDomain; selected: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer mb-0.5 ${
                selected
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
            }`}
        >
            <span className="flex items-center gap-2 min-w-0">
                <FaviconImg domain={d.domain} />
                <span className="truncate">{d.domain}</span>
            </span>
            <span className={`ml-2 text-xs flex-shrink-0 font-medium ${selected ? 'text-indigo-200' : 'text-gray-400'}`}>
                {d.count}
            </span>
        </button>
    );
}


// ── Main page ──────────────────────────────────────────────────────────────

export function ValidEmailsPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [domains,        setDomains]        = React.useState<ValidEmailsDomain[]>([]);
    const [emails,         setEmails]         = React.useState<ValidEmailEntry[]>([]);
    const [total,          setTotal]          = React.useState(0);
    const [selectedDomain, setSelectedDomain] = React.useState<string | null>(searchParams.get('domain'));
    const [loading,        setLoading]        = React.useState(true);
    const [error,          setError]          = React.useState('');
    const [page,           setPage]           = React.useState(1);
    const [hasMore,        setHasMore]        = React.useState(false);
    const [search,         setSearch]         = React.useState(searchParams.get('search') ?? '');
    const [selected,       setSelected]       = React.useState<Set<string>>(new Set());
    const [activeContact,  setActiveContact]  = React.useState<ValidEmailEntry | null>(null);

    // Filters (status is server-side; others are client-side on loaded data)
    const [filterStatus,      setFilterStatus]      = React.useState<'all' | 'valid' | 'catch_all'>('all');
    const [filterSource,      setFilterSource]      = React.useState<'all' | 'single' | 'csv' | 'api'>('all');
    const [filterHasPhone,    setFilterHasPhone]    = React.useState(false);
    const [filterHasLinkedin, setFilterHasLinkedin] = React.useState(false);
    const [filterRole,        setFilterRole]        = React.useState<RoleCategory | 'all'>('all');

    const PER_PAGE = 50;

    const load = React.useCallback(async (p: number, domain: string | null, reset: boolean, status: 'all' | 'valid' | 'catch_all') => {
        try {
            if (reset) setLoading(true);
            setError('');
            const data = await validEmailsApi.getValidEmails(p, PER_PAGE, domain, status === 'all' ? null : status);
            setDomains(data.domains);
            setTotal(data.total);
            setHasMore(p * PER_PAGE < data.total);
            setEmails(prev => reset ? data.emails : [...prev, ...data.emails]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        setPage(1); setEmails([]); setSelected(new Set());
        load(1, selectedDomain, true, filterStatus);
    }, [selectedDomain, filterStatus, load]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if ((el.scrollTop + el.clientHeight) / el.scrollHeight > 0.85 && hasMore && !loading) {
            const next = page + 1;
            setPage(next);
            load(next, selectedDomain, false, filterStatus);
        }
    };

    const handleUpdate = async (email: string, fields: Partial<ValidEmailEntry>) => {
        await validEmailsApi.updateContact(email, fields);
        setEmails(prev => prev.map(e => e.email === email ? { ...e, ...fields } : e));
        // Keep panel in sync
        setActiveContact(prev => prev?.email === email ? { ...prev, ...fields } : prev);
    };

    const handleSelect = (email: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(email) ? next.delete(email) : next.add(email);
            return next;
        });
    };

    const handleRowClick = (entry: ValidEmailEntry) => {
        setActiveContact(prev => prev?.email === entry.email ? null : entry);
    };

    const filtered = React.useMemo(() => {
        let list = emails;
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(e =>
                e.email.toLowerCase().includes(q) ||
                (e.first_name ?? '').toLowerCase().includes(q) ||
                (e.last_name  ?? '').toLowerCase().includes(q) ||
                (e.job_title  ?? '').toLowerCase().includes(q) ||
                (e.company_name ?? '').toLowerCase().includes(q)
            );
        }
        if (filterSource !== 'all')  list = list.filter(e => e.source === filterSource);
        if (filterHasPhone)          list = list.filter(e => !!e.phone);
        if (filterHasLinkedin)       list = list.filter(e => !!e.linkedin_url);
        if (filterRole !== 'all')    list = list.filter(e => classifyRole(e.job_title) === filterRole);
        return list;
    }, [emails, search, filterSource, filterHasPhone, filterHasLinkedin, filterRole]);

    const allSelected = filtered.length > 0 && selected.size === filtered.length;
    const handleSelectAll = () =>
        setSelected(allSelected ? new Set() : new Set(filtered.map(e => e.email)));

    const handleExport = () => {
        const rows = filtered.filter(e => selected.has(e.email));
        const header = 'email,first_name,last_name,job_title,company_name,personal_email,phone,city,country,tags,source';
        const csv = [header, ...rows.map(e =>
            [e.email, e.first_name, e.last_name, e.job_title, e.company_name,
             e.personal_email, e.phone, e.city, e.country, e.tags, e.source]
                .map(v => v ? `"${String(v).replace(/"/g, '""')}"` : '').join(',')
        )].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'contacts.csv'; a.click();
    };

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden font-sans">

            {/* ── Top navbar ── */}
            <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 cursor-pointer transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-sm font-semibold text-gray-900 leading-none">People</h1>
                        <p className="text-xs text-gray-400 mt-0.5 leading-none">
                            {total > 0 ? `${total.toLocaleString()} contacts · ${domains.length} companies` : 'Your verified contacts'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                        <input
                            type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search people…"
                            className="w-64 pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-300 bg-gray-50 hover:bg-white transition-colors"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* ── Filter bar ── */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-100 bg-gray-50/60 flex-shrink-0 flex-wrap">

                {/* Status filter */}
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
                    {(['all', 'valid', 'catch_all'] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setFilterStatus(s)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                filterStatus === s
                                    ? s === 'catch_all'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {s === 'all' ? 'All' : s === 'valid' ? 'Valid' : 'Catch-all'}
                        </button>
                    ))}
                </div>

                <div className="w-px h-4 bg-gray-200" />

                {/* Source filter */}
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
                    {(['all', 'single', 'csv', 'api'] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setFilterSource(s)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                filterSource === s
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {s === 'all' ? 'All sources' : s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="w-px h-4 bg-gray-200" />

                {/* Toggle filters */}
                <button
                    onClick={() => setFilterHasPhone(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        filterHasPhone
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Phone className="h-3 w-3" /> Has phone
                </button>
                <button
                    onClick={() => setFilterHasLinkedin(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        filterHasLinkedin
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Linkedin className="h-3 w-3" /> Has LinkedIn
                </button>

                {/* Active filter count */}
                {(filterStatus !== 'all' || filterSource !== 'all' || filterHasPhone || filterHasLinkedin || filterRole !== 'all') && (
                    <button
                        onClick={() => { setFilterStatus('all'); setFilterSource('all'); setFilterHasPhone(false); setFilterHasLinkedin(false); setFilterRole('all'); }}
                        className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                    >
                        <X className="h-3 w-3" /> Clear filters
                    </button>
                )}
            </div>

            {/* ── Error ── */}
            {error && (
                <div className="mx-5 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-sm text-red-700 flex-shrink-0">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
                </div>
            )}

            <div className="flex flex-1 overflow-hidden">

                {/* ── Sidebar ── */}
                <aside className="w-56 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">

                    {/* All contacts — always visible */}
                    <div className="px-2 pt-3 pb-1 flex-shrink-0">
                        <button
                            onClick={() => setSelectedDomain(null)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer ${
                                selectedDomain === null
                                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <Users className="h-4 w-4 flex-shrink-0 opacity-70" />
                                All contacts
                            </span>
                            <span className={`text-xs font-medium ${selectedDomain === null ? 'text-indigo-200' : 'text-gray-400'}`}>{total}</span>
                        </button>
                    </div>

                    {/* Scrollable sections */}
                    <div className="flex-1 overflow-y-auto px-2 pb-3">
                        <SidebarSection label="Roles" defaultOpen={true}>
                            {ROLE_CATEGORIES.map(cat => {
                                const count = emails.filter(e => classifyRole(e.job_title) === cat.key).length;
                                if (count === 0) return null;
                                const active = filterRole === cat.key;
                                return (
                                    <button
                                        key={cat.key}
                                        onClick={() => setFilterRole(active ? 'all' : cat.key)}
                                        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer mb-0.5 ${
                                            active ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        <span className="truncate">{cat.label}</span>
                                        <span className={`ml-2 text-xs flex-shrink-0 font-medium ${active ? 'text-indigo-200' : 'text-gray-400'}`}>{count}</span>
                                    </button>
                                );
                            })}
                        </SidebarSection>

                        <SidebarSection label="Companies" defaultOpen={true}>
                            {loading && domains.length === 0
                                ? [1,2,3,4].map(i => <div key={i} className="my-1 h-8 bg-gray-100 rounded-lg animate-pulse" />)
                                : domains.map(d => (
                                    <DomainItem
                                        key={d.domain} d={d}
                                        selected={selectedDomain === d.domain}
                                        onClick={() => setSelectedDomain(d.domain)}
                                    />
                                ))
                            }
                        </SidebarSection>
                    </div>
                </aside>

                {/* ── Main content ── */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* Bulk toolbar */}
                    <AnimatePresence>
                        {selected.size > 0 && (
                            <motion.div
                                initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -40, opacity: 0 }} transition={{ duration: 0.12 }}
                                className="flex items-center gap-3 px-5 py-2.5 bg-indigo-600 text-white text-sm flex-shrink-0 shadow-md z-20"
                            >
                                <span className="font-semibold">{selected.size} selected</span>
                                <span className="opacity-30">|</span>
                                <button
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(
                                            filtered.filter(e => selected.has(e.email)).map(e => e.email).join('\n')
                                        );
                                        toast.success(`${selected.size} emails copied`);
                                    }}
                                    className="flex items-center gap-1.5 hover:text-indigo-200 cursor-pointer transition-colors"
                                >
                                    <Copy className="h-3.5 w-3.5" /> Copy emails
                                </button>
                                <button onClick={handleExport} className="flex items-center gap-1.5 hover:text-indigo-200 cursor-pointer transition-colors">
                                    <Download className="h-3.5 w-3.5" /> Export CSV
                                </button>
                                <button onClick={() => setSelected(new Set())} className="ml-auto text-indigo-300 hover:text-white cursor-pointer transition-colors text-xs">
                                    Clear selection
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Table */}
                    <div className="flex-1 overflow-auto" onScroll={handleScroll}>
                        <table className="w-full border-collapse text-left">
                            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b-2 border-gray-200">
                                <tr>
                                    <th className="w-10 pl-4 pr-2 py-3">
                                        <input
                                            type="checkbox" checked={allSelected} onChange={handleSelectAll}
                                            className="rounded border-gray-300 text-indigo-600 cursor-pointer"
                                        />
                                    </th>
                                    {COL_HEADERS.map(col => (
                                        <th key={col.key} className="px-3 py-3 whitespace-nowrap">
                                            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                                <span className="text-gray-500">{col.icon}</span>
                                                {col.label}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody>
                                {loading && emails.length === 0 ? (
                                    [...Array(12)].map((_, i) => (
                                        <tr key={i} className="border-b border-gray-100">
                                            <td className="pl-4 pr-2 py-3 w-10">
                                                <div className="h-4 w-4 bg-gray-100 rounded animate-pulse" />
                                            </td>
                                            {[200, 180, 130, 100, 90, 60].map((w, j) => (
                                                <td key={j} className="px-3 py-3">
                                                    <div
                                                        className="h-4 bg-gray-100 rounded-full animate-pulse"
                                                        style={{ width: `${w * (0.5 + (i * j * 3 % 50) / 100)}px` }}
                                                    />
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                ) : filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-28 text-center">
                                            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                                                <Users className="h-7 w-7 text-gray-400" />
                                            </div>
                                            <p className="text-gray-700 text-base font-medium">
                                                {search ? 'No results found' : 'No contacts yet'}
                                            </p>
                                            <p className="text-gray-400 text-sm mt-1">
                                                {search ? `No contacts match "${search}"` : 'Verify emails to see contacts here'}
                                            </p>
                                        </td>
                                    </tr>
                                ) : filtered.map(entry => {
                                    const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
                                    const src = SOURCE_PILL[entry.source] ?? { label: entry.source, cls: 'bg-gray-100 text-gray-600' };
                                    const isActive = activeContact?.email === entry.email;
                                    return (
                                        <tr
                                            key={entry.email}
                                            className={`group border-b border-gray-100 transition-colors cursor-pointer ${
                                                isActive ? 'bg-indigo-50/60' : selected.has(entry.email) ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            }`}
                                            onClick={() => handleRowClick(entry)}
                                        >
                                            {/* Checkbox */}
                                            <td className="w-10 pl-4 pr-2 py-3 align-middle" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox" checked={selected.has(entry.email)}
                                                    onChange={() => handleSelect(entry.email)}
                                                    className="rounded border-gray-300 text-indigo-600 cursor-pointer"
                                                />
                                            </td>

                                            {/* Name + avatar */}
                                            <td className="px-3 py-3 align-middle min-w-[200px]">
                                                <div className="flex items-center gap-2.5">
                                                    <Avatar entry={entry} />
                                                    <div className="min-w-0">
                                                        <p className={`text-sm font-medium leading-snug truncate ${name ? 'text-gray-900' : 'text-gray-400 italic font-normal'}`}>
                                                            {name || 'No name'}
                                                        </p>
                                                        {entry.job_title && (
                                                            <p className="text-xs text-gray-500 truncate leading-tight font-medium">{entry.job_title}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Work email */}
                                            <td className="px-3 py-3 align-middle min-w-[200px]">
                                                <div className="flex items-center group/cell" onClick={e => e.stopPropagation()}>
                                                    <span className="text-sm text-gray-700 font-mono truncate">{entry.email}</span>
                                                    <CopyBtn value={entry.email} />
                                                </div>
                                            </td>

                                            {/* Company */}
                                            <td className="px-3 py-3 align-middle min-w-[140px]">
                                                <div className="flex items-center gap-2">
                                                    <FaviconImg domain={entry.domain} />
                                                    <span className="text-sm text-gray-700 truncate">
                                                        {entry.company_name || entry.domain}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Phone */}
                                            <td className="px-3 py-3 align-middle min-w-[130px]">
                                                {entry.phone ? (
                                                    <div className="flex items-center group/cell" onClick={e => e.stopPropagation()}>
                                                        <span className="text-sm text-gray-600 font-mono truncate">{entry.phone}</span>
                                                        <CopyBtn value={entry.phone} />
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-gray-300">—</span>
                                                )}
                                            </td>

                                            {/* Location */}
                                            <td className="px-3 py-3 align-middle min-w-[110px]">
                                                <span className="text-sm text-gray-500 truncate">
                                                    {[entry.city, entry.country].filter(Boolean).join(', ') || '—'}
                                                </span>
                                            </td>

                                            {/* Source + status */}
                                            <td className="px-3 py-3 align-middle">
                                                <div className="flex flex-col gap-1 items-start">
                                                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${src.cls}`}>
                                                        {src.label}
                                                    </span>
                                                    {entry.email_status === 'catch_all' && (
                                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                                                            Catch-all
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Footer */}
                        {!hasMore && filtered.length > 0 && !loading && (
                            <div className="py-5 text-center border-t border-gray-100">
                                <p className="text-xs text-gray-400">
                                    Showing all {filtered.length.toLocaleString()} contact{filtered.length !== 1 ? 's' : ''}
                                    {selectedDomain ? ` from ${selectedDomain}` : ''}
                                    {search ? ` matching "${search}"` : ''}
                                </p>
                            </div>
                        )}

                        {loading && emails.length > 0 && (
                            <div className="py-5 text-center">
                                <div className="inline-flex items-center gap-2 text-xs text-gray-400">
                                    <div className="h-3.5 w-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                                    Loading more contacts…
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Right slide-in contact panel ── */}
            <AnimatePresence>
                {activeContact && (
                    <ContactPanel
                        key={activeContact.email}
                        entry={activeContact}
                        onClose={() => setActiveContact(null)}
                        onUpdate={handleUpdate}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
