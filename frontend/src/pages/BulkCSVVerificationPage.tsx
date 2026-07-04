/**
 * Bulk CSV Verification Page
 * Separate page for Step 2 of bulk verification (column selection)
 * Persists on refresh using localStorage
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { DashboardLayout } from '../components/layout';
import { BulkVerifierStepTwo } from '../components/verifier/BulkVerifierStepTwo';
import { Button } from '../components/ui/Button';
import { verificationApi } from '../lib/api';
import type { CSVFullDataResult } from '../lib/csvParser';


// LocalStorage key for CSV data
const CSV_DATA_KEY = 'bulk_csv_verification_data';


// Interface for stored CSV data
interface StoredCSVData {
    csvUploadId: string;
    parsedData: CSVFullDataResult;
    timestamp: number;
}


/**
 * Bulk CSV Verification Page Component
 * @returns JSX element
 */
export function BulkCSVVerificationPage() {
    const navigate = useNavigate();
    const [isVerifying, setIsVerifying] = useState(false);
    const [csvData, setCsvData] = useState<StoredCSVData | null>(null);
    const [isLoading, setIsLoading] = useState(true);


    // Load CSV data from localStorage on mount
    useEffect(() => {
        try {
            const storedData = localStorage.getItem(CSV_DATA_KEY);

            if (!storedData) {
                toast.error('No CSV data found. Please upload a CSV file first.');
                navigate('/dashboard');
                return;
            }

            const parsedStoredData: StoredCSVData = JSON.parse(storedData);

            // Check if data is not too old (24 hours)
            const dataAge = Date.now() - parsedStoredData.timestamp;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

            if (dataAge > maxAge) {
                toast.error('CSV data has expired. Please upload again.');
                localStorage.removeItem(CSV_DATA_KEY);
                navigate('/dashboard');
                return;
            }

            setCsvData(parsedStoredData);
            setIsLoading(false);

        } catch (error) {
            console.error('Error loading CSV data:', error);
            toast.error('Failed to load CSV data. Please upload again.');
            localStorage.removeItem(CSV_DATA_KEY);
            navigate('/dashboard');
        }
    }, [navigate]);


    /**
     * Handle verification submission
     */
    const handleVerify = async (selectedColumn: string, fieldMapping: Record<string, number>) => {
        try {
            if (!csvData) {
                throw new Error('No CSV data available');
            }

            // Disable button immediately to prevent multiple clicks
            setIsVerifying(true);

            // Get the column index from parsedData
            const columnIndex = csvData.parsedData.headers.indexOf(selectedColumn) ?? -1;
            if (columnIndex === -1) {
                throw new Error('Invalid column selection');
            }

            // Submit to backend API
            const verificationResponse = await verificationApi.submitCSVVerification(
                csvData.csvUploadId,
                columnIndex,
                fieldMapping
            );

            // Clear stored data after successful submission
            localStorage.removeItem(CSV_DATA_KEY);

            // Show success message
            toast.success(`Verification started for ${verificationResponse.total_emails} emails!`);

            // Navigate to verification details page
            navigate(`/verify/${verificationResponse.verification_request_id}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit verification';
            console.error('Verification error:', error);
            toast.error(errorMessage);
            // Reset state on error
            setIsVerifying(false);
        }
    };


    /**
     * Handle back navigation
     */
    const handleBack = () => {
        try {
            // Clear stored data when going back
            localStorage.removeItem(CSV_DATA_KEY);
            navigate('/dashboard');
        } catch (error) {
            console.error('Back navigation error:', error);
        }
    };


    return (
        <DashboardLayout>
            <div className="px-4 sm:px-6 lg:px-8 py-12">
                <div className="w-full max-w-5xl mx-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
                        </div>
                    ) : csvData ? (
                        <>
                            {/* Back button */}
                            <div className="mb-6">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleBack}
                                    className="flex items-center space-x-1 cursor-pointer"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    <span>Back to Dashboard</span>
                                </Button>
                            </div>

                            {/* Step 2: Column Selection */}
                            <BulkVerifierStepTwo
                                parsedData={csvData.parsedData}
                                onVerify={handleVerify}
                                isVerifying={isVerifying}
                            />
                        </>
                    ) : null}
                </div>
            </div>
        </DashboardLayout>
    );
}
