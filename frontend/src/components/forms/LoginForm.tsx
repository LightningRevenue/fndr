/**
 * Simple login form component with email/password
 * Single-step login flow for simple authentication
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { Mail, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Input } from '../ui';
import {
    loginSchema,
    type LoginFormData
} from '../../lib/validations';


interface LoginFormProps {
    onLogin: (data: LoginFormData) => Promise<void>;
    loading?: boolean;
}


/**
 * Simple login form component
 * @param onLogin - Handler for login
 * @param loading - Loading state
 * @returns LoginForm JSX element
 */
export function LoginForm({
    onLogin,
    loading = false,
}: LoginFormProps) {
    try {
        const form = useForm<LoginFormData>({
            resolver: zodResolver(loginSchema),
            defaultValues: {
                email: '',
                password: '',
            },
        });


        const handleSubmit = async (data: LoginFormData) => {
            try {
                await onLogin(data);
            } catch (error) {
                console.error('Login error:', error);
            }
        };


        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
            >
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <Input
                        {...form.register('email')}
                        type="email"
                        label="Email address"
                        placeholder="you@example.com"
                        startIcon={<Mail className="h-4 w-4" />}
                        error={form.formState.errors.email?.message}
                        fullWidth
                        autoComplete="email"
                        autoFocus
                    />

                    <Input
                        {...form.register('password')}
                        type="password"
                        label="Password"
                        placeholder="Enter your password"
                        startIcon={<Lock className="h-4 w-4" />}
                        error={form.formState.errors.password?.message}
                        fullWidth
                        autoComplete="current-password"
                    />

                    <Button
                        type="submit"
                        fullWidth
                        loading={loading}
                    >
                        Sign in
                    </Button>
                </form>

                <p className="text-center text-sm text-gray-500">
                    Don't have an account?{' '}
                    <Link to="/register" className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer">
                        Create one
                    </Link>
                </p>
            </motion.div>
        );
    } catch (error) {
        console.error('LoginForm render error:', error);

        return (
            <div className="space-y-4">
                <p className="text-sm text-error-600">
                    Something went wrong. Please refresh the page and try again.
                </p>
                <Button
                    onClick={() => window.location.reload()}
                    variant="outline"
                    fullWidth
                >
                    Refresh page
                </Button>
            </div>
        );
    } finally {
        // Debug logging omitted for production
    }
}