/**
 * Prospect page — find companies via Google Maps, direct name search, or LinkedIn profile URL
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Building2, Search, Info, Linkedin, CheckCircle, XCircle, Loader2, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { config } from '../data/env';
import { toast } from 'react-toastify';
import { CompanyCard } from '../components/prospect/CompanyCard';
import type { CompanyRow, OwnerResult } from '../components/prospect/CompanyCard';


const LS_KEY = 'prospect_maps_key';

type Mode = 'maps' | 'company' | 'linkedin' | 'search';


interface MapsSearchResponse {
    success: boolean;
    data: { companies: CompanyRow[] };
}

interface FindOwnerResponse {
    success: boolean;
    data: { owner: OwnerResult | null };
}

interface CompanySearchResponse {
    success: boolean;
    data: { name: string; domain: string; owner: OwnerResult | null };
}

interface LinkedInScrapeResponse {
    success: boolean;
    message?: string;
    data: {
        firstName: string;
        lastName: string;
        role: string;
        companyLinkedinUrl: string;
        domain: string;
    };
}

interface FindEmailResponse {
    success: boolean;
    data: { email: string | null };
}

interface LinkedInSearchResponse {
    success: boolean;
    message?: string;
    data: { profiles: Array<{ name: string; title: string; url: string; snippet: string }> };
}

interface LinkedInResult {
    firstName: string;
    lastName: string;
    role: string;
    domain: string;
    email: string | null;
    step: 'idle' | 'scraping' | 'finding-email' | 'done' | 'error';
    error?: string;
}


async function apiPost<T>(path: string, body: Record<string, string>): Promise<T> {
    const res = await fetch(`${config.api.baseUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json() as T;
    if (!res.ok) {
        const msg = (json as { message?: string }).message || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${config.api.baseUrl}${path}`, { credentials: 'include' });
    const json = await res.json() as T;
    if (!res.ok) {
        const msg = (json as { message?: string }).message || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}


export function ProspectPage() {
    const navigate = useNavigate();

    const [mode, setMode] = React.useState<Mode>('maps');

    // Maps inputs
    const [apiKey, setApiKey]     = React.useState<string>(() => localStorage.getItem(LS_KEY) ?? '');
    const [query, setQuery]       = React.useState('');
    const [location, setLocation] = React.useState('Romania');

    // Company input
    const [companyName, setCompanyName] = React.useState('');

    // LinkedIn profile input
    const [linkedinUrl, setLinkedinUrl] = React.useState('');
    const [linkedinResult, setLinkedinResult] = React.useState<LinkedInResult | null>(null);

    // LinkedIn search inputs + results
    const [searchJobTitle, setSearchJobTitle] = React.useState('');
    const [searchLocation, setSearchLocation] = React.useState('Romania');
    const [searchProfiles, setSearchProfiles] = React.useState<Array<{ name: string; title: string; url: string; snippet: string }>>([]);

    // Results
    const [companies, setCompanies]       = React.useState<CompanyRow[]>([]);
    const [owners, setOwners]             = React.useState<Record<string, OwnerResult>>({});
    const [ownerLoading, setOwnerLoading] = React.useState<Set<string>>(new Set());
    const [loading, setLoading]           = React.useState(false);


    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        localStorage.setItem(LS_KEY, val);
    };

    const resetResults = () => { setCompanies([]); setOwners({}); setLinkedinResult(null); setSearchProfiles([]); };


    const handleMapsSearch = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            if (!apiKey.trim()) { toast.error('Please enter your Google Maps API key'); return; }
            if (!query.trim())  { toast.error('Please enter a search query'); return; }
            setLoading(true);
            setCompanies([]);
            setOwners({});
            const res = await apiPost<MapsSearchResponse>('/api/prospect/maps-search', { query, location, apiKey });
            setCompanies(res.data.companies);
            if (res.data.companies.length === 0) toast.info('No companies found. Try a different query or location.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Maps search failed');
        } finally {
            setLoading(false);
        }
    };


    const handleCompanySearch = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            if (!companyName.trim()) { toast.error('Please enter a company name'); return; }
            setLoading(true);
            setCompanies([]);
            setOwners({});
            const res = await apiPost<CompanySearchResponse>('/api/prospect/company-search', { companyName });
            const row: CompanyRow = {
                place_id: companyName,
                name:     res.data.name,
                address:  '',
                rating:   null,
                website:  res.data.domain ? `https://${res.data.domain}` : '',
                phone:    '',
                domain:   res.data.domain,
            };
            setCompanies([row]);
            if (res.data.owner) setOwners({ [companyName]: res.data.owner });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Company search failed');
        } finally {
            setLoading(false);
        }
    };


    const handleLinkedInSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        const url = linkedinUrl.trim();
        if (!url || !url.includes('linkedin.com/in/')) {
            toast.error('Please enter a valid LinkedIn profile URL');
            return;
        }

        setLinkedinResult({ firstName: '', lastName: '', role: '', domain: '', email: null, step: 'scraping' });

        try {
            // Step 1: scrape profile
            const scraped = await apiPost<LinkedInScrapeResponse>('/api/prospect/linkedin-profile', { profileUrl: url });

            if (!scraped.success) {
                setLinkedinResult((p) => ({ ...p!, step: 'error', error: scraped.message ?? 'Scrape failed' }));
                return;
            }

            const { firstName, lastName, role, domain } = scraped.data;
            setLinkedinResult({ firstName, lastName, role, domain, email: null, step: 'finding-email' });

            if (!domain) {
                setLinkedinResult((p) => ({ ...p!, step: 'done' }));
                return;
            }

            // Step 2: find email
            const params = new URLSearchParams({ firstName, lastName, domain });
            const emailRes = await apiGet<FindEmailResponse>(`/api/verifier/find-email?${params.toString()}`);
            const email = emailRes.data?.email ?? null;

            setLinkedinResult((p) => ({ ...p!, email, step: 'done' }));
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Search failed';
            setLinkedinResult((p) => ({ ...p!, step: 'error', error: msg }));
        }
    };


    const handlePeopleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchJobTitle.trim()) { toast.error('Please enter a job title'); return; }
        setLoading(true);
        setSearchProfiles([]);
        try {
            const res = await apiPost<LinkedInSearchResponse>('/api/prospect/linkedin-search', {
                jobTitle: searchJobTitle,
                location: searchLocation,
            });
            setSearchProfiles(res.data.profiles);
            if (res.data.profiles.length === 0) toast.info('No profiles found. Try a different query.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Search failed');
        } finally {
            setLoading(false);
        }
    };

    const handleFindOwner = async (company: CompanyRow) => {
        try {
            setOwnerLoading((prev) => new Set(prev).add(company.place_id));
            const res = await apiPost<FindOwnerResponse>('/api/prospect/find-owner', {
                companyName: company.name,
                domain:      company.domain,
            });
            if (res.data.owner) {
                setOwners((prev) => ({ ...prev, [company.place_id]: res.data.owner! }));
            } else {
                toast.info(`No owner found for ${company.name}`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Owner lookup failed');
        } finally {
            setOwnerLoading((prev) => {
                const next = new Set(prev);
                next.delete(company.place_id);
                return next;
            });
        }
    };


    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* Header */}
                <div className="mb-8 flex items-center space-x-4">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}
                        className="flex items-center space-x-1 cursor-pointer">
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Prospect</h1>
                        <p className="text-sm text-gray-500 mt-0.5">Find companies and discover owner emails</p>
                    </div>
                </div>

                {/* Mode tabs */}
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 w-fit">
                    {([
                        { key: 'maps',     label: 'Maps Search',    icon: <MapPin className="h-4 w-4" /> },
                        { key: 'company',  label: 'Company Search', icon: <Building2 className="h-4 w-4" /> },
                        { key: 'linkedin', label: 'LinkedIn',       icon: <Linkedin className="h-4 w-4" /> },
                        { key: 'search',   label: 'People Search', icon: <Users className="h-4 w-4" /> },
                    ] as { key: Mode; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
                        <button
                            key={key}
                            onClick={() => { setMode(key); resetResults(); }}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                mode === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {icon}
                            {label}
                        </button>
                    ))}
                </div>

                {/* Search form */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                        <CardContent className="p-6">

                            {mode === 'maps' && (
                                <form onSubmit={handleMapsSearch} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">
                                            Google Maps API Key
                                        </label>
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => handleApiKeyChange(e.target.value)}
                                            placeholder="AIza..."
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] transition-colors"
                                        />
                                        <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-400">
                                            <Info className="h-3 w-3 flex-shrink-0" />
                                            Stored locally in your browser.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Search Query</label>
                                            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                                                placeholder="restaurante, avocati..." disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Location</label>
                                            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                                                placeholder="Romania" disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
                                        </div>
                                    </div>
                                    <Button type="submit" variant="primary" disabled={loading} loading={loading} className="cursor-pointer">
                                        <Search className="h-4 w-4 mr-2" />
                                        {loading ? 'Searching...' : 'Search Maps'}
                                    </Button>
                                </form>
                            )}

                            {mode === 'company' && (
                                <form onSubmit={handleCompanySearch} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Company Name</label>
                                        <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="Acme SRL" disabled={loading}
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors" />
                                    </div>
                                    <Button type="submit" variant="primary" disabled={loading} loading={loading} className="cursor-pointer">
                                        <Search className="h-4 w-4 mr-2" />
                                        {loading ? 'Searching...' : 'Search Company'}
                                    </Button>
                                </form>
                            )}

                            {mode === 'linkedin' && (
                                <form onSubmit={handleLinkedInSearch} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">
                                            LinkedIn Profile URL
                                        </label>
                                        <input
                                            type="url"
                                            value={linkedinUrl}
                                            onChange={(e) => setLinkedinUrl(e.target.value)}
                                            placeholder="https://www.linkedin.com/in/username"
                                            disabled={linkedinResult?.step === 'scraping' || linkedinResult?.step === 'finding-email'}
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                        />
                                        <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-400">
                                            <Info className="h-3 w-3 flex-shrink-0" />
                                            Uses ScraperAPI — requires key set in API Keys → Integrations.
                                        </p>
                                    </div>
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        disabled={linkedinResult?.step === 'scraping' || linkedinResult?.step === 'finding-email'}
                                        loading={linkedinResult?.step === 'scraping' || linkedinResult?.step === 'finding-email'}
                                        className="cursor-pointer"
                                    >
                                        <Search className="h-4 w-4 mr-2" />
                                        {linkedinResult?.step === 'scraping' ? 'Scraping profile...'
                                            : linkedinResult?.step === 'finding-email' ? 'Finding email...'
                                            : 'Find Email'}
                                    </Button>
                                </form>
                            )}

                            {mode === 'search' && (
                                <form onSubmit={handlePeopleSearch} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Job Title</label>
                                            <input
                                                type="text"
                                                value={searchJobTitle}
                                                onChange={(e) => setSearchJobTitle(e.target.value)}
                                                placeholder="marketing director"
                                                disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Location</label>
                                            <input
                                                type="text"
                                                value={searchLocation}
                                                onChange={(e) => setSearchLocation(e.target.value)}
                                                placeholder="Romania"
                                                disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                            />
                                        </div>
                                    </div>
                                    <p className="flex items-center gap-1 text-xs text-gray-400">
                                        <Info className="h-3 w-3 flex-shrink-0" />
                                        Uses Bright Data SERP API. Requires key set in API Keys → Integrations.
                                    </p>
                                    <Button type="submit" variant="primary" disabled={loading} loading={loading} className="cursor-pointer">
                                        <Search className="h-4 w-4 mr-2" />
                                        {loading ? 'Searching...' : 'Search People'}
                                    </Button>
                                </form>
                            )}

                        </CardContent>
                    </Card>
                </motion.div>

                {/* People search results */}
                {mode === 'search' && searchProfiles.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-3">
                        <p className="text-sm text-gray-500 font-medium">{searchProfiles.length} profiles found</p>
                        {searchProfiles.map((p, i) => (
                            <Card key={i}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                                            {p.title && <p className="text-xs text-gray-500 mt-0.5">{p.title}</p>}
                                            {p.snippet && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{p.snippet}</p>}
                                        </div>
                                        <a
                                            href={p.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0077b5] text-white text-xs font-medium rounded-lg hover:bg-[#006097] transition-colors flex-shrink-0 cursor-pointer"
                                        >
                                            <Linkedin className="h-3.5 w-3.5" />
                                            View
                                        </a>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </motion.div>
                )}

                {/* LinkedIn result card */}
                {mode === 'linkedin' && linkedinResult && linkedinResult.step !== 'idle' && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
                        <Card>
                            <CardContent className="p-6">

                                {/* Loading states */}
                                {(linkedinResult.step === 'scraping' || linkedinResult.step === 'finding-email') && (
                                    <div className="flex items-center gap-3 text-sm text-gray-500">
                                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                        {linkedinResult.step === 'scraping' ? 'Scraping LinkedIn profile...' : 'Searching for email...'}
                                    </div>
                                )}

                                {/* Error */}
                                {linkedinResult.step === 'error' && (
                                    <div className="flex items-center gap-3 text-sm text-red-600">
                                        <XCircle className="h-4 w-4 flex-shrink-0" />
                                        {linkedinResult.error}
                                    </div>
                                )}

                                {/* Results */}
                                {linkedinResult.step === 'done' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Name</p>
                                                <p className="text-sm font-semibold text-gray-900">
                                                    {[linkedinResult.firstName, linkedinResult.lastName].filter(Boolean).join(' ') || '—'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Role</p>
                                                <p className="text-sm text-gray-700">{linkedinResult.role || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Domain</p>
                                                <p className="text-sm text-gray-700">{linkedinResult.domain || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Email</p>
                                                {linkedinResult.email ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                                                        <p className="text-sm font-medium text-green-700">{linkedinResult.email}</p>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-gray-400 italic">not found</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Maps / Company results */}
                {companies.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
                        <p className="text-sm text-gray-500 font-medium">
                            {companies.length} {companies.length === 1 ? 'company' : 'companies'} found
                        </p>
                        {companies.map((company) => (
                            <CompanyCard
                                key={company.place_id}
                                company={company}
                                owner={owners[company.place_id]}
                                ownerLoading={ownerLoading.has(company.place_id)}
                                onFindOwner={handleFindOwner}
                            />
                        ))}
                    </motion.div>
                )}

            </div>
        </div>
    );
}
