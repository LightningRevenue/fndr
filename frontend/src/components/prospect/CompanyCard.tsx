/**
 * CompanyCard — displays a single prospect result with owner and Find Email action
 */

import { useNavigate } from 'react-router-dom';
import { Building2, Globe, Phone, Star, UserSearch, Mail, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';


export interface CompanyRow {
    place_id: string;
    name: string;
    address: string;
    rating: number | null;
    website: string;
    phone: string;
    domain: string;
}

export interface OwnerResult {
    firstName: string;
    lastName: string;
    source: string;
    confidence: 'high' | 'medium' | 'low';
}

interface CompanyCardProps {
    company: CompanyRow;
    owner: OwnerResult | undefined;
    ownerLoading: boolean;
    onFindOwner: (company: CompanyRow) => void;
}


// Confidence badge colour map
const CONFIDENCE_CLASSES: Record<OwnerResult['confidence'], string> = {
    high:   'bg-green-100 text-green-700 border-green-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low:    'bg-gray-100 text-gray-500 border-gray-200',
};


/**
 * Company prospect card
 */
export function CompanyCard({ company, owner, ownerLoading, onFindOwner }: CompanyCardProps) {
    const navigate = useNavigate();

    const handleFindEmail = () => {
        try {
            if (!owner) return;
            const params = new URLSearchParams({
                firstName: owner.firstName,
                lastName:  owner.lastName,
                domain:    company.domain || '',
            });
            navigate(`/find-email?${params.toString()}`);
        } catch (err) {
            console.error('CompanyCard handleFindEmail error:', err);
        }
    };

    return (
        <Card className="hover:shadow-md transition-shadow duration-200">
            <CardContent className="p-5">

                {/* Company header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-[#2F327D]/10 flex items-center justify-center flex-shrink-0">
                            <Building2 className="h-4 w-4 text-[#2F327D]" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{company.name}</p>
                            {company.address && (
                                <p className="text-xs text-gray-400 truncate">{company.address}</p>
                            )}
                        </div>
                    </div>

                    {/* Rating */}
                    {company.rating !== null && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                            <span className="text-xs text-gray-600 font-medium">{company.rating.toFixed(1)}</span>
                        </div>
                    )}
                </div>


                {/* Links row */}
                <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
                    {company.website && (
                        <a
                            href={company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-[#2F327D] transition-colors cursor-pointer"
                        >
                            <Globe className="h-3.5 w-3.5" />
                            <span className="truncate max-w-[160px]">{company.domain || company.website}</span>
                        </a>
                    )}
                    {company.phone && (
                        <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {company.phone}
                        </span>
                    )}
                </div>


                {/* Owner section */}
                {owner ? (
                    <div className="bg-gray-50 rounded-lg p-3 mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Owner / Director</p>
                            <p className="font-medium text-gray-900 truncate">
                                {owner.firstName} {owner.lastName}
                            </p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize flex-shrink-0 ${CONFIDENCE_CLASSES[owner.confidence]}`}>
                            {owner.confidence}
                        </span>
                    </div>
                ) : null}


                {/* Action buttons */}
                <div className="flex gap-2">
                    {!owner && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={ownerLoading}
                            onClick={() => onFindOwner(company)}
                            className="cursor-pointer text-gray-600 hover:text-[#2F327D] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {ownerLoading ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                                <UserSearch className="h-4 w-4 mr-1.5" />
                            )}
                            {ownerLoading ? 'Searching...' : 'Find Owner'}
                        </Button>
                    )}

                    {owner && company.domain && (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleFindEmail}
                            className="cursor-pointer"
                        >
                            <Mail className="h-4 w-4 mr-1.5" />
                            Find Email
                        </Button>
                    )}
                </div>

            </CardContent>
        </Card>
    );
}
