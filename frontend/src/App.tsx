/**
 * Main application component
 * Sets up routing and global providers
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute';
import {
    LoginPage,
    RegisterPage,
    PendingApprovalPage,
    DashboardPage,
    NotFoundPage,
    APIKeyPage,
    HistoryPage,
    VerificationProgressPage,
    VerificationResultsPage,
    BulkCSVVerificationPage,
    ValidEmailsPage,
    FindEmailPage,
    ProspectPage
} from './pages';


/**
 * Main App component with routing
 * @returns JSX element for the application
 */
export default function App() {
    try {
        return (
            <Router>
                <div className="min-h-screen bg-gray-50">
                    {/* Toast notifications container */}
                    <ToastContainer
                        position="top-right"
                        autoClose={4000}
                        hideProgressBar={false}
                        newestOnTop={false}
                        closeOnClick
                        rtl={false}
                        pauseOnFocusLoss
                        draggable
                        pauseOnHover
                        theme="light"
                        toastStyle={{
                            background: '#fff',
                            color: '#374151',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontFamily: 'Poppins, system-ui, sans-serif',
                        }}
                    />

                    {/* Application routes */}
                    <Routes>
                        {/* Root redirect */}
                        <Route
                            path="/"
                            element={<Navigate to="/login" replace />}
                        />

                        {/* Public routes (redirect if authenticated) */}
                        <Route
                            path="/login"
                            element={
                                <PublicRoute>
                                    <LoginPage />
                                </PublicRoute>
                            }
                        />

                        <Route path="/register" element={<RegisterPage />} />
                        <Route path="/pending-approval" element={<PendingApprovalPage />} />

                        {/* Protected routes (require authentication) */}
                        <Route
                            path="/dashboard"
                            element={
                                <ProtectedRoute>
                                    <DashboardPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/dashboard/csv"
                            element={
                                <ProtectedRoute>
                                    <BulkCSVVerificationPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/api-tokens"
                            element={
                                <ProtectedRoute>
                                    <APIKeyPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/history"
                            element={
                                <ProtectedRoute>
                                    <HistoryPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/valid-emails"
                            element={
                                <ProtectedRoute>
                                    <ValidEmailsPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/find-email"
                            element={
                                <ProtectedRoute>
                                    <FindEmailPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/prospect"
                            element={
                                <ProtectedRoute>
                                    <ProspectPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/verify/:verificationRequestId"
                            element={
                                <ProtectedRoute>
                                    <VerificationProgressPage />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/results/:verificationRequestId"
                            element={
                                <ProtectedRoute>
                                    <VerificationResultsPage />
                                </ProtectedRoute>
                            }
                        />

                        {/* 404 page */}
                        <Route
                            path="*"
                            element={<NotFoundPage />}
                        />
                    </Routes>
                </div>
            </Router>
        );
    } catch (error) {
        console.error('App render error:', error);

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center space-y-4">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Application Error
                    </h1>
                    <p className="text-gray-600">
                        Something went wrong loading the application.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors cursor-pointer"
                    >
                        Reload Application
                    </button>
                </div>
            </div>
        );
    } finally {
        // Debug logging omitted for production
    }
}