/**
 * Prospect page — find companies via Google Maps or direct name search,
 * then discover owner names via SERP scraping
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Building2, Search, Info } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { config } from '../data/env';
import { toast } from 'react-toastify';
import { CompanyCard } from '../components/prospect/CompanyCard';
import type { CompanyRow, OwnerResult } from '../components/prospect/CompanyCard';


// Local storage key for Maps API key
const LS_KEY = 'prospect_maps_key';

type Mode = 'maps' | 'company';


// Shape returned by /api/prospect/maps-search
interface MapsSearchResponse {
    success: boolean;
    data: { companies: CompanyRow[] };
}

// Shape returned by /api/prospect/find-owner
interface FindOwnerResponse {
    success: boolean;
    data: { owner: OwnerResult | null };
}

// Shape returned by /api/prospect/company-search
interface CompanySearchResponse {
    success: boolean;
    data: { name: string; domain: string; owner: OwnerResult | null };
}


/**
 * Thin fetch wrapper — always sends cookies
 */
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


/**
 * Prospect page component
 */
export function ProspectPage() {
    const navigate = useNavigate();

    // Mode toggle
    const [mode, setMode] = React.useState<Mode>('maps');

    // Maps-mode inputs
    const [apiKey, setApiKey]     = React.useState<string>(() => localStorage.getItem(LS_KEY) ?? '');
    const [query, setQuery]       = React.useState('');
    const [location, setLocation] = React.useState('Romania');

    // Company-mode input
    const [companyName, setCompanyName] = React.useState('');

    // Results
    const [companies, setCompanies]       = React.useState<CompanyRow[]>([]);
    const [owners, setOwners]             = React.useState<Record<string, OwnerResult>>({});
    const [ownerLoading, setOwnerLoading] = React.useState<Set<string>>(new Set());
    const [loading, setLoading]           = React.useState(false);


    // Persist API key to localStorage on change
    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        localStorage.setItem(LS_KEY, val);
    };


    // Maps search
    const handleMapsSearch = async (e: React.FormEvent) => {
        try {
            e.preventDefault();

            if (!apiKey.trim()) { toast.error('Please enter your Google Maps API key'); return; }
            if (!query.trim())  { toast.error('Please enter a search query'); return; }

            setLoading(true);
            setCompanies([]);
            setOwners({});

            const res = await apiPost<MapsSearchResponse>('/api/prospect/maps-search', {
                query,
                location,
                apiKey,
            });

            setCompanies(res.data.companies);

            if (res.data.companies.length === 0) {
                toast.info('No companies found. Try a different query or location.');
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Maps search failed');
        } finally {
            setLoading(false);
        }
    };


    // Company name search
    const handleCompanySearch = async (e: React.FormEvent) => {
        try {
            e.preventDefault();

            if (!companyName.trim()) { toast.error('Please enter a company name'); return; }

            setLoading(true);
            setCompanies([]);
            setOwners({});

            const res = await apiPost<CompanySearchResponse>('/api/prospect/company-search', {
                companyName,
            });

            const row: CompanyRow = {
                place_id: companyName, // use name as key in company-search mode
                name:     res.data.name,
                address:  '',
                rating:   null,
                website:  res.data.domain ? `https://${res.data.domain}` : '',
                phone:    '',
                domain:   res.data.domain,
            };

            setCompanies([row]);

            if (res.data.owner) {
                setOwners({ [companyName]: res.data.owner });
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Company search failed');
        } finally {
            setLoading(false);
        }
    };


    // Per-card "Find Owner" click
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
                    <button
                        onClick={() => { setMode('maps'); setCompanies([]); setOwners({}); }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            mode === 'maps'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <MapPin className="h-4 w-4" />
                        Maps Search
                    </button>
                    <button
                        onClick={() => { setMode('company'); setCompanies([]); setOwners({}); }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            mode === 'company'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Building2 className="h-4 w-4" />
                        Company Search
                    </button>
                </div>


                {/* Search form */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                        <CardContent className="p-6">
                            {mode === 'maps' ? (
                                <form onSubmit={handleMapsSearch} className="space-y-4">

                                    {/* API Key */}
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
                                            Stored locally in your browser. Never sent to our servers except when calling Google Maps API.
                                        </p>
                                    </div>

                                    {/* Query + Location */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Search Query</label>
                                            <input
                                                type="text"
                                                value={query}
                                                onChange={(e) => setQuery(e.target.value)}
                                                placeholder="restaurante, avocati..."
                                                disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Location</label>
                                            <input
                                                type="text"
                                                value={location}
                                                onChange={(e) => setLocation(e.target.value)}
                                                placeholder="Romania"
                                                disabled={loading}
                                                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <Button type="submit" variant="primary" disabled={loading} loading={loading} className="cursor-pointer">
                                        <Search className="h-4 w-4 mr-2" />
                                        {loading ? 'Searching...' : 'Search Maps'}
                                    </Button>
                                </form>
                            ) : (
                                <form onSubmit={handleCompanySearch} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1.5 uppercase tracking-wide">Company Name</label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="Acme SRL"
                                            disabled={loading}
                                            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2F327D]/30 focus:border-[#2F327D] disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                                        />
                                    </div>

                                    <Button type="submit" variant="primary" disabled={loading} loading={loading} className="cursor-pointer">
                                        <Search className="h-4 w-4 mr-2" />
                                        {loading ? 'Searching...' : 'Search Company'}
                                    </Button>
                                </form>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>


                {/* Results */}
                {companies.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 space-y-4"
                    >
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
