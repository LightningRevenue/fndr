/**
 * Bulk Verifier Step Two Component
 * Column selection and field mapping for email verification
 */

import { useState, useEffect, useRef } from 'react';
import { Mail, Info, AlertTriangle, MapPin } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import type { CSVFullDataResult } from '../../lib/csvParser';


// Field mapping configuration
const FIELD_DEFINITIONS: { key: string; label: string; hints: string[] }[] = [
    { key: 'first_name',   label: 'First Name',        hints: ['first_name', 'first', 'firstname', 'given_name'] },
    { key: 'last_name',    label: 'Last Name',         hints: ['last_name', 'last', 'lastname', 'surname', 'family_name'] },
    { key: 'phone',        label: 'Phone',             hints: ['phone', 'phone_number', 'phonenumber', 'mobile', 'tel', 'telephone'] },
    { key: 'linkedin_url', label: 'LinkedIn URL',      hints: ['linkedin', 'linkedin_url', 'profile_url', 'linkedin_profile'] },
    { key: 'job_title',    label: 'Job Title / Role',  hints: ['job_title', 'title', 'role', 'position', 'jobtitle'] },
    { key: 'company_name', label: 'Company',           hints: ['company', 'company_name', 'organization', 'org', 'employer'] },
];


// Normalize header for hint matching (lowercase, collapse spaces/underscores)
const normalizeHint = (s: string): string => s.toLowerCase().replace(/[\s_]+/g, '_');


// Interface for component props
interface BulkVerifierStepTwoProps {
    parsedData: CSVFullDataResult;
    onVerify: (selectedColumn: string, fieldMapping: Record<string, number>) => void;
    isVerifying?: boolean;
}


/**
 * Bulk Verifier Step Two Component
 * @param props - Component props
 * @returns JSX element
 */
export function BulkVerifierStepTwo({
    parsedData,
    onVerify,
    isVerifying = false
}: BulkVerifierStepTwoProps) {
    // Normalize column name for comparison (handle space vs underscore mismatch)
    const normalizeColumnName = (name: string | null): string => {
        if (!name) return '';
        // Replace underscores with spaces and normalize whitespace
        return name.replace(/_/g, ' ').trim();
    };

    // Find the actual header that matches the detected column
    const detectedColumnRaw = parsedData.detectedEmailColumn;
    const normalizedDetected = normalizeColumnName(detectedColumnRaw);
    const detectedColumn = parsedData.headers.find(h => normalizeColumnName(h) === normalizedDetected) || null;

    const [selectedColumn, setSelectedColumn] = useState<string>(
        detectedColumn || parsedData.headers[0] || ''
    );
    const [userHasSelected, setUserHasSelected] = useState<boolean>(false);

    // Ref for the detected column to scroll into view
    const detectedColumnRef = useRef<HTMLTableCellElement>(null);


    // Auto-detect field mapping: for each field, find the first header that matches a hint
    const autoDetectMapping = (): Record<string, string> => {
        const result: Record<string, string> = {};
        for (const field of FIELD_DEFINITIONS) {
            const match = parsedData.headers.find(h =>
                field.hints.includes(normalizeHint(h))
            );
            if (match !== undefined) {
                result[field.key] = String(parsedData.headers.indexOf(match));
            } else {
                result[field.key] = '';
            }
        }
        return result;
    };

    // fieldMapping values are column index as string, or '' to skip
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(autoDetectMapping);


    // Auto-scroll to detected column on mount
    useEffect(() => {
        if (detectedColumnRef.current && detectedColumn) {
            detectedColumnRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
        }
    }, [detectedColumn]);


    // Email stats calculation removed - backend handles email extraction and validation
    // since the CSV is already uploaded and stored on the server


    const handleColumnSelect = (header: string) => {
        // Step 1: Clear previous selection first (force re-render to remove old highlight)
        setSelectedColumn('');

        // Step 2: Then set new selection after 100ms delay
        setTimeout(() => {
            setSelectedColumn(header);
            setUserHasSelected(true);
        }, 100);
    };


    const handleVerifyEmails = () => {
        try {
            if (!selectedColumn) {
                return;
            }

            // Build numeric field mapping — only include non-skip entries
            const numericMapping: Record<string, number> = {};
            for (const [key, val] of Object.entries(fieldMapping)) {
                if (val !== '') {
                    numericMapping[key] = parseInt(val, 10);
                }
            }

            // Backend will extract emails from the uploaded CSV using the selected column
            onVerify(selectedColumn, numericMapping);
        } catch (error) {
            console.error('Verify emails error:', error);
        }
    };


    // Get header background color based on confidence and selection
    const getHeaderBgColor = (header: string): string => {
        const isSelected = selectedColumn === header;
        const isDetected = detectedColumn === header;
        const confidence = parsedData.detectionConfidence || 0;

        // User manually selected this column - dark green (highest priority)
        if (userHasSelected && isSelected) {
            return 'bg-green-700 text-white';
        }

        // Auto-detected column showing before user selection (confidence-based colors)
        // Only show if detectedColumn exists
        if (!userHasSelected && isDetected && detectedColumn) {
            if (confidence >= 80) {
                return 'bg-green-500 text-white';
            } else if (confidence >= 50) {
                return 'bg-orange-400 text-white';
            } else {
                return 'bg-red-400 text-white';
            }
        }

        // Default state - no highlighting
        return 'text-[#2F327D] hover:bg-green-100';
    };


    // Get cell background color based on confidence and selection
    const getCellBgColor = (header: string): string => {
        const isSelected = selectedColumn === header;
        const isDetected = detectedColumn === header;
        const confidence = parsedData.detectionConfidence || 0;

        // User manually selected this column - dark green tint (highest priority)
        if (userHasSelected && isSelected) {
            return 'bg-green-100 text-gray-900 font-medium';
        }

        // Auto-detected column showing before user selection (confidence-based colors)
        // Only show if detectedColumn exists
        if (!userHasSelected && isDetected && detectedColumn) {
            if (confidence >= 80) {
                return 'bg-green-50 text-gray-900 font-medium';
            } else if (confidence >= 50) {
                return 'bg-orange-50 text-gray-900 font-medium';
            } else {
                return 'bg-red-50 text-gray-900 font-medium';
            }
        }

        // Default state - no highlighting
        return 'text-gray-700';
    };


    return (
        <div className="space-y-6">
            {/* Header section */}
            <Card>
                <CardContent className="p-6">
                    <div className="flex items-center space-x-2 text-[#2F327D] mb-4">
                        <Mail className="h-5 w-5" />
                        <h3 className="font-semibold">Select the column with Emails</h3>
                    </div>

                    {/* Detection confidence warning */}
                    {parsedData.detectionConfidence !== undefined && parsedData.detectionConfidence < 80 && (
                        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start space-x-2">
                            <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-sm font-medium text-orange-800">
                                    {parsedData.detectionConfidence >= 50
                                        ? 'Moderate confidence in email detection'
                                        : 'Low confidence in email detection'}
                                </p>
                                <p className="text-xs text-orange-700 mt-1">
                                    We detected "{detectedColumn}" as the email column with {parsedData.detectionConfidence.toFixed(0)}% confidence.
                                    Please verify the selection below or choose a different column.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Table with column selection */}
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-blue-50">
                                <tr>
                                    {parsedData.headers.map((header) => (
                                        <th
                                            key={header}
                                            ref={header === detectedColumn ? detectedColumnRef : null}
                                            onClick={() => handleColumnSelect(header)}
                                            className={`
                                                px-4 py-3 text-left text-sm font-semibold cursor-pointer
                                                ${getHeaderBgColor(header)}
                                            `}
                                        >
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {parsedData.preview.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-gray-50">
                                        {parsedData.headers.map((header) => (
                                            <td
                                                key={header}
                                                className={`
                                                    px-4 py-3 text-sm whitespace-nowrap
                                                    ${getCellBgColor(header)}
                                                `}
                                            >
                                                {row[header] || '-'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Stats section */}
            <div className="flex items-center space-x-2 text-sm text-gray-700">
                <Info className="h-4 w-4 text-blue-500" />
                <p>
                    *Select the column with most unique and valid syntax emails.
                </p>
            </div>


            {/* Field mapping section */}
            <Card>
                <CardContent className="p-6">
                    <div className="flex items-center space-x-2 text-[#2F327D] mb-4">
                        <MapPin className="h-5 w-5" />
                        <h3 className="font-semibold">Map additional fields <span className="text-sm font-normal text-gray-500">(optional)</span></h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {FIELD_DEFINITIONS.map((field) => (
                            <div key={field.key} className="flex flex-col space-y-1">
                                <label
                                    htmlFor={`field-map-${field.key}`}
                                    className="text-xs font-medium text-gray-600 cursor-pointer"
                                >
                                    {field.label}
                                </label>
                                <select
                                    id={`field-map-${field.key}`}
                                    value={fieldMapping[field.key] ?? ''}
                                    onChange={(e) =>
                                        setFieldMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors duration-200 hover:border-gray-300"
                                >
                                    <option value="">— skip —</option>
                                    {parsedData.headers.map((header, idx) => (
                                        <option key={idx} value={String(idx)}>
                                            {header}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>


            {/* Action buttons */}
            <div className="flex justify-end">
                <Button
                    variant="primary"
                    onClick={handleVerifyEmails}
                    disabled={isVerifying || !selectedColumn}
                    className="cursor-pointer"
                >
                    {isVerifying ? 'Verifying...' : 'Verify emails'}
                </Button>
            </div>
        </div>
    );
}
