/**
 * Register page — any visitor can create an account.
 * First user ever is auto-approved; all others wait for admin approval.
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, Lock } from 'lucide-react';
import { toast } from 'react-toastify';
import { AuthLayout } from '../components/layout';
import { Input, Button } from '../components/ui';
import { authApi } from '../lib/api';
import * as z from 'zod';
import { emailSchema, passwordSchema } from '../lib/validations';

const schema = z.object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'This field is required'),
}).refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
type FormData = z.infer<typeof schema>;


export function RegisterPage() {
    try {
        const navigate = useNavigate();
        const [loading, setLoading] = useState(false);

        const form = useForm<FormData>({
            resolver: zodResolver(schema),
            defaultValues: { email: '', password: '', confirmPassword: '' },
        });

        const handleSubmit = async (data: FormData) => {
            try {
                setLoading(true);
                const result = await authApi.register(data.email, data.password);

                if (result.status === 'approved') {
                    toast.success('Account created! You can now log in.');
                    navigate('/login');
                } else {
                    navigate('/pending-approval');
                }
            } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Registration failed');
            } finally {
                setLoading(false);
            }
        };

        return (
            <AuthLayout
                title="Create an account"
                subtitle="Sign up to get started"
            >
                <div className="space-y-6">
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
                            placeholder="Min 8 chars, upper + lower + number + special"
                            startIcon={<Lock className="h-4 w-4" />}
                            error={form.formState.errors.password?.message}
                            fullWidth
                            autoComplete="new-password"
                        />

                        <Input
                            {...form.register('confirmPassword')}
                            type="password"
                            label="Confirm password"
                            placeholder="Repeat your password"
                            startIcon={<Lock className="h-4 w-4" />}
                            error={form.formState.errors.confirmPassword?.message}
                            fullWidth
                            autoComplete="new-password"
                        />

                        <Button type="submit" fullWidth loading={loading}>
                            Create account
                        </Button>
                    </form>

                    <p className="text-center text-sm text-gray-500">
                        Already have an account?{' '}
                        <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer">
                            Sign in
                        </Link>
                    </p>
                </div>
            </AuthLayout>
        );

    } catch (error) {
        console.error('RegisterPage render error:', error);
        return (
            <AuthLayout title="Create account" subtitle="">
                <p className="text-sm text-red-600 text-center">Something went wrong. Please refresh.</p>
            </AuthLayout>
        );
    }
}
