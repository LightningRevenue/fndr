/**
 * Shown after a new user registers and is waiting for admin approval.
 */

import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { AuthLayout } from '../components/layout';


export function PendingApprovalPage() {
    return (
        <AuthLayout
            title="Waiting for approval"
            subtitle="Your account has been created"
        >
            <div className="text-center space-y-5 py-2">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
                    <Clock className="h-7 w-7 text-amber-500" />
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                    An admin needs to approve your account before you can log in.
                    You'll be able to sign in once your account is approved.
                </p>
                <Link
                    to="/login"
                    className="inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                    Back to login
                </Link>
            </div>
        </AuthLayout>
    );
}
