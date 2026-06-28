/**
 * Dashboard layout component
 * Simple, mobile-friendly layout for authenticated user pages
 */

import React, { useState, useEffect } from 'react';
import { LogOut, Key, History, CheckCircle2, UserSearch, Building2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Button } from '../ui';
import { authApi, verificationApi } from '../../lib/api';
import { Port25Badge } from './Port25Badge';
import type { Port25Status } from './Port25Badge';
import { Port25WarningBanner } from './Port25WarningBanner';


interface DashboardLayoutProps {
    children: React.ReactNode;
}

/**
 * Simple dashboard layout with header and main content
 * @param children - Page content
 * @returns DashboardLayout JSX element
 */
export function DashboardLayout({
    children,
}: DashboardLayoutProps) {
    try {
        const location = useLocation();
        const navigate = useNavigate();
        const [isLoggingOut, setIsLoggingOut] = useState(false);
        const [port25Status, setPort25Status] = useState<Port25Status>('unknown');
        const [isCheckingPort25, setIsCheckingPort25] = useState(false);
        const [showWarningBanner, setShowWarningBanner] = useState(false);
        const [warningMessage, setWarningMessage] = useState('');


        const handleLogout = async () => {
            try {
                setIsLoggingOut(true);

                // Call backend logout endpoint to destroy session
                await authApi.logout();

                toast.success('Logged out successfully');
                navigate('/login', { replace: true });
            } catch (error) {
                console.error('Error during logout:', error);
                toast.error('Logout failed. Please try again.');
            } finally {
                setIsLoggingOut(false);
            }
        };


        const checkPort25Status = async () => {
            try {
                setIsCheckingPort25(true);
                setPort25Status('checking');

                const result = await verificationApi.checkPort25();

                if (result.port25Open) {
                    setPort25Status('open');
                    setShowWarningBanner(false);
                } else {
                    setPort25Status('closed');
                    if (result.recommendation) {
                        setWarningMessage(result.recommendation);
                        setShowWarningBanner(true);
                    }
                }

            } catch (error) {
                console.error('Port 25 check failed:', error);
                setPort25Status('unknown');
                setShowWarningBanner(false);
                toast.error('Unable to check port 25 connectivity');
            } finally {
                setIsCheckingPort25(false);
            }
        };


        const handleDismissWarning = () => {
            setShowWarningBanner(false);
        };


        // Auto-check port 25 on component mount (once)
        useEffect(() => {
            checkPort25Status();
        }, []);


        const isActiveRoute = (path: string) => {
            return location.pathname === path || location.pathname.startsWith(path + '/');
        };

        return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                {/* Header */}
                <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
                    <div className="px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between h-16">
                            {/* Logo and title */}
                            <div className="flex items-center space-x-3">
                                <Link to="/dashboard" className="flex items-center space-x-3 cursor-pointer">
                                    <img
                                        src="/logo.svg"
                                        alt="BrandNav Logo"
                                        className="h-8 w-auto p-2"
                                    />
                                    <div className="hidden sm:block">
                                        <h1 className="text-lg font-semibold text-gray-900">
                                            BrandNav
                                        </h1>
                                    </div>
                                </Link>
                            </div>

                            {/* Navigation and user actions */}
                            <div className="flex items-center space-x-2">
                                {/* Navigation links - Always visible, icon-only on mobile */}
                                <nav className="flex items-center space-x-1">
                                    <Port25Badge
                                        status={port25Status}
                                        onClick={checkPort25Status}
                                        disabled={isCheckingPort25}
                                    />
                                    <Link
                                        to="/api-tokens"
                                        className={`p-2.5 md:px-3 md:py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center md:space-x-2 ${isActiveRoute('/api-tokens')
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        aria-label="API Keys"
                                    >
                                        <Key className="h-5 w-5" />
                                        <span className="hidden md:inline">API Keys</span>
                                    </Link>
                                    <Link
                                        to="/history"
                                        className={`p-2.5 md:px-3 md:py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center md:space-x-2 ${isActiveRoute('/history')
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        aria-label="History"
                                    >
                                        <History className="h-5 w-5" />
                                        <span className="hidden md:inline">History</span>
                                    </Link>
                                    <Link
                                        to="/find-email"
                                        className={`p-2.5 md:px-3 md:py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center md:space-x-2 ${isActiveRoute('/find-email')
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        aria-label="Find Email"
                                    >
                                        <UserSearch className="h-5 w-5" />
                                        <span className="hidden md:inline">Find Email</span>
                                    </Link>
                                    <Link
                                        to="/prospect"
                                        className={`p-2.5 md:px-3 md:py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center md:space-x-2 ${isActiveRoute('/prospect')
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        aria-label="Prospect"
                                    >
                                        <Building2 className="h-5 w-5" />
                                        <span className="hidden md:inline">Prospect</span>
                                    </Link>
                                    <Link
                                        to="/valid-emails"
                                        className={`p-2.5 md:px-3 md:py-2 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center md:space-x-2 ${isActiveRoute('/valid-emails')
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        aria-label="Valid Emails"
                                    >
                                        <CheckCircle2 className="h-5 w-5" />
                                        <span className="hidden md:inline">Valid Emails</span>
                                    </Link>
                                </nav>

                                {/* Logout button */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleLogout}
                                    disabled={isLoggingOut}
                                    className="text-gray-600 hover:text-gray-900 cursor-pointer p-2.5 md:px-3 md:py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Sign out"
                                >
                                    <LogOut className="h-5 w-5" />
                                    <span className="hidden sm:inline ml-2">
                                        {isLoggingOut ? 'Signing out...' : 'Sign out'}
                                    </span>
                                </Button>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Port 25 Warning Banner */}
                {showWarningBanner && (
                    <Port25WarningBanner
                        message={warningMessage}
                        onDismiss={handleDismissWarning}
                    />
                )}

                {/* Main content */}
                <main className="flex-1">
                    {children}
                </main>
            </div>
        );
    } catch (error) {
        console.error('DashboardLayout render error:', error);

        return (
            <div className="min-h-screen bg-gray-50 p-4">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-lg shadow p-6">
                        <h1 className="text-xl font-bold mb-4">Dashboard</h1>
                        {children}
                    </div>
                </div>
            </div>
        );
    } finally {
        // Debug logging omitted for production
    }
}