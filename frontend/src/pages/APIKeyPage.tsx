/**
 * API Key Management Page
 * Allows users to create, view, and revoke API keys
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Key,
    Plus,
    Trash2,
    Copy,
    CheckCircle,
    AlertCircle,
    ArrowLeft
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { CardSkeleton } from '../components/ui/Skeleton';
import { Input } from '../components/ui/Input';
import { toast } from 'react-toastify';
import { apiKeyApi } from '../lib/api';
import type { ApiKey } from '../lib/api';

/**
 * API Key management page
 * @returns APIKeyPage JSX element
 */
export function APIKeyPage() {
    const navigate = useNavigate();
    const location = useLocation();

    // State management
    const [keys, setKeys] = React.useState<ApiKey[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string>('');
    const [showCreateForm, setShowCreateForm] = React.useState(false);

    // Create key form state
    const [keyName, setKeyName] = React.useState('');
    const [expiryDays, setExpiryDays] = React.useState<number | ''>('');
    const [newKey, setNewKey] = React.useState<string>('');
    const [copiedKeyId, setCopiedKeyId] = React.useState<string>('');

    // Bright Data key state
    const [brightdataKey, setBrightdataKey] = React.useState('');
    const [brightdataKeyMasked, setBrightdataKeyMasked] = React.useState('');
    const [brightdataKeyIsSet, setBrightdataKeyIsSet] = React.useState(false);
    const [brightdataKeySaving, setBrightdataKeySaving] = React.useState(false);

    // Bright Data SERP key state
    const [serpKey, setSerpKey] = React.useState('');
    const [serpKeyMasked, setSerpKeyMasked] = React.useState('');
    const [serpKeyIsSet, setSerpKeyIsSet] = React.useState(false);
    const [serpKeySaving, setSerpKeySaving] = React.useState(false);

    // Load keys on mount and whenever we navigate to this page
    React.useEffect(() => {
        loadKeys();
        loadBrightdataKey();
        loadSerpKey();
    }, [location.pathname]);

    // Also reload when page becomes visible again (handles browser tab switching)
    React.useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                loadKeys();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);


    const loadSerpKey = async () => {
        try {
            const res = await fetch('/api/settings/brightdata-serp-key', { credentials: 'include' });
            const data = await res.json() as { success: boolean; data: { isSet: boolean; masked: string } };
            if (data.success) {
                setSerpKeyIsSet(data.data.isSet);
                setSerpKeyMasked(data.data.masked);
            }
        } catch (_) { /* silent */ }
    };

    const handleSaveSerpKey = async () => {
        if (!serpKey.trim()) return;
        setSerpKeySaving(true);
        try {
            const res = await fetch('/api/settings/brightdata-serp-key', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: serpKey.trim() }),
            });
            const data = await res.json() as { success: boolean; message: string };
            if (data.success) {
                toast.success('Bright Data SERP key saved');
                setSerpKey('');
                await loadSerpKey();
            } else {
                toast.error(data.message);
            }
        } catch (_) {
            toast.error('Failed to save key');
        } finally {
            setSerpKeySaving(false);
        }
    };

    const loadBrightdataKey = async () => {
        try {
            const res = await fetch('/api/settings/brightdata-api-key', { credentials: 'include' });
            const data = await res.json() as { success: boolean; data: { isSet: boolean; masked: string } };
            if (data.success) {
                setBrightdataKeyIsSet(data.data.isSet);
                setBrightdataKeyMasked(data.data.masked);
            }
        } catch (_) { /* silent */ }
    };

    const handleSaveBrightdataKey = async () => {
        if (!brightdataKey.trim()) return;
        setBrightdataKeySaving(true);
        try {
            const res = await fetch('/api/settings/brightdata-api-key', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: brightdataKey.trim() }),
            });
            const data = await res.json() as { success: boolean; message: string };
            if (data.success) {
                toast.success('Bright Data key saved');
                setBrightdataKey('');
                await loadBrightdataKey();
            } else {
                toast.error(data.message);
            }
        } catch (_) {
            toast.error('Failed to save key');
        } finally {
            setBrightdataKeySaving(false);
        }
    };

    const loadKeys = async () => {
        try {
            setLoading(true);
            setError('');

            const apiKeys = await apiKeyApi.listApiKeys();
            setKeys(apiKeys);

        } catch (error) {
            console.error('Failed to load API keys:', error);
            setError(error instanceof Error ? error.message : 'Failed to load API keys');
            toast.error(error instanceof Error ? error.message : 'Failed to load API keys');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateKey = async () => {
        // Set loading state immediately to prevent multiple clicks
        setLoading(true);
        setError('');

        try {
            // Validate inputs
            if (!keyName.trim()) {
                setError('Please enter a key name');
                toast.error('Please enter a key name');
                return;
            }

            const response = await apiKeyApi.createApiKey(
                keyName.trim(),
                expiryDays ? Number(expiryDays) : null
            );

            // Store the full plain-text API key to display
            setNewKey(response.apiKey);

            // Add masked version to keys list
            const newKeyData: ApiKey = {
                id: response.keyData.id,
                name: response.keyData.name,
                key_masked: `${response.keyData.key_prefix}***xyz`,
                created_at: response.keyData.created_at,
                expires_at: response.keyData.expires_at,
                last_used: null,
                is_revoked: false
            };

            setKeys(prev => [newKeyData, ...prev]);
            toast.success('API key created successfully!');

            // Reset form fields but keep newKey to show warning
            setKeyName('');
            setExpiryDays('');

        } catch (error) {
            console.error('Failed to create API key:', error);
            setError(error instanceof Error ? error.message : 'Failed to create API key');
            toast.error(error instanceof Error ? error.message : 'Failed to create API key');
        } finally {
            setLoading(false);
        }
    };

    const handleRevokeKey = async (keyId: number) => {
        try {
            if (!confirm('Are you sure you want to revoke this key? This action cannot be undone.')) {
                return;
            }

            setLoading(true);
            setError('');

            await apiKeyApi.revokeApiKey(keyId);

            // Remove from list
            setKeys(prev => prev.filter(k => k.id !== keyId));
            toast.success('API key revoked successfully');

        } catch (error) {
            console.error('Failed to revoke API key:', error);
            setError(error instanceof Error ? error.message : 'Failed to revoke API key');
            toast.error(error instanceof Error ? error.message : 'Failed to revoke API key');
        } finally {
            setLoading(false);
        }
    };

    const handleCopyKey = (key: string, keyId: number | string) => {
        try {
            navigator.clipboard.writeText(key);
            setCopiedKeyId(String(keyId));
            toast.success('Key copied to clipboard');

            // Reset copied state after 2 seconds
            setTimeout(() => {
                setCopiedKeyId('');
            }, 2000);
        } catch (error) {
            console.error('Failed to copy key:', error);
            toast.error('Failed to copy key');
        }
    };

    const handleBackNavigation = () => {
        try {
            navigate('/dashboard');
        } catch (error) {
            console.error('Back navigation error:', error);
            window.history.back();
        }
    };

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Never expires';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatRelativeTime = (dateString: string | null) => {
        try {
            if (!dateString) return 'Never';

            const date = new Date(dateString);

            // Check for invalid date
            if (isNaN(date.getTime())) {
                return 'Never';
            }

            const now = new Date();
            const diff = now.getTime() - date.getTime();

            // Handle future dates (clock skew)
            if (diff < 0) return 'Just now';

            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return 'Just now';
            if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
            if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
            return `${days} ${days === 1 ? 'day' : 'days'} ago`;
        } catch (error) {
            console.error('Format relative time error:', error);
            return 'Never';
        } finally {
            // No cleanup needed
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header with Back Button */}
                <div className="mb-8">
                    <div className="flex flex-col items-start space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                        <div className="flex flex-col items-start space-y-4 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleBackNavigation}
                                className="flex items-center space-x-1 cursor-pointer"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Back</span>
                            </Button>
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">
                                    API Keys
                                </h1>
                                <p className="text-gray-600 mt-1">
                                    Create and manage API keys for programmatic access
                                </p>
                            </div>
                        </div>

                        <Button
                            variant="primary"
                            onClick={() => setShowCreateForm(!showCreateForm)}
                            className="flex items-center space-x-2 cursor-pointer"
                            disabled={loading}
                        >
                            <Plus className="h-4 w-4" />
                            <span>Create Key</span>
                        </Button>
                    </div>
                </div>

                {/* Error display */}
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6"
                    >
                        <Card className="border-red-200 bg-red-50">
                            <CardContent className="p-4">
                                <div className="flex items-center space-x-2">
                                    <AlertCircle className="h-5 w-5 text-red-600" />
                                    <span className="text-sm text-red-800">{error}</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setError('')}
                                        className="ml-auto cursor-pointer"
                                    >
                                        Dismiss
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Create Token Form */}
                {showCreateForm && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6"
                    >
                        <Card>
                            <CardHeader>
                                <CardTitle>Create New API Key</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {newKey ? (
                                    // Show only the key warning after creation
                                    <>
                                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                            <div className="flex items-start space-x-2">
                                                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-yellow-900 mb-2">
                                                        Save this key now! You won't be able to see it again.
                                                    </p>
                                                    <div className="flex items-center space-x-2">
                                                        <code className="flex-1 px-3 py-2 bg-white border border-yellow-300 rounded text-sm font-mono text-gray-900 break-all">
                                                            {newKey}
                                                        </code>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleCopyKey(newKey, 'new')}
                                                            className="cursor-pointer flex-shrink-0"
                                                        >
                                                            <Copy className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-4 border-t">
                                            <Button
                                                variant="primary"
                                                onClick={() => {
                                                    setShowCreateForm(false);
                                                    setKeyName('');
                                                    setExpiryDays('');
                                                    setNewKey('');
                                                }}
                                                className="cursor-pointer"
                                            >
                                                Close
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    // Show form fields before key creation
                                    <>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <Input
                                                label="Key Name"
                                                type="text"
                                                placeholder="e.g., Production API"
                                                value={keyName}
                                                onChange={(e) => setKeyName(e.target.value)}
                                                helper="A descriptive name for this key"
                                                fullWidth
                                            />

                                            <Input
                                                label="Expiry (days)"
                                                type="number"
                                                placeholder="e.g., 30 (leave empty for no expiry)"
                                                value={expiryDays}
                                                onChange={(e) => setExpiryDays(e.target.value ? parseInt(e.target.value) : '')}
                                                helper="Key will expire after this many days"
                                                fullWidth
                                            />
                                        </div>

                                        <div className="flex justify-end space-x-3 pt-4 border-t">
                                            <Button
                                                variant="outline"
                                                onClick={() => {
                                                    setShowCreateForm(false);
                                                    setKeyName('');
                                                    setExpiryDays('');
                                                }}
                                                disabled={loading}
                                                className="cursor-pointer"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                variant="primary"
                                                onClick={handleCreateKey}
                                                disabled={loading || !keyName.trim()}
                                                loading={loading}
                                                className="cursor-pointer"
                                            >
                                                Create Key
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Keys List */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2">
                                <Key className="h-5 w-5" />
                                <span>Your API Keys</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {loading && keys.length === 0 ? (
                                <CardSkeleton rows={3} />
                            ) : keys.length === 0 ? (
                                <div className="text-center py-12">
                                    <Key className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                                        No API Keys
                                    </h3>
                                    <p className="text-sm text-gray-600 mb-4">
                                        Create your first API key to start using the API
                                    </p>
                                    <Button
                                        variant="primary"
                                        onClick={() => setShowCreateForm(true)}
                                        className="cursor-pointer"
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        Create Key
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {keys.map((key) => (
                                        <div
                                            key={key.id}
                                            className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-3 mb-2">
                                                        <h3 className="text-base font-semibold text-gray-900">
                                                            {key.name}
                                                        </h3>
                                                        {key.expires_at && (
                                                            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                                                                Expires {formatDate(key.expires_at)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center space-x-2 mb-3">
                                                        <code className="px-3 py-1.5 bg-gray-100 rounded text-sm font-mono text-gray-700">
                                                            {key.key_masked}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleCopyKey(key.key_masked, key.id)}
                                                            className="cursor-pointer"
                                                        >
                                                            {copiedKeyId === String(key.id) ? (
                                                                <CheckCircle className="h-4 w-4 text-green-600" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>

                                                    <div className="flex items-center space-x-4 text-xs">
                                                        <span className="text-gray-500">Created {formatDate(key.created_at)}</span>
                                                        <span className="text-gray-300">•</span>
                                                        <span className="text-gray-600">
                                                            Last used: <span className="font-medium text-blue-600">{formatRelativeTime(key.last_used)}</span>
                                                        </span>
                                                    </div>
                                                </div>

                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleRevokeKey(key.id)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                                                    disabled={loading}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Integrations */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="mt-6"
                >
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center space-x-2">
                                <Key className="h-5 w-5" />
                                <span>Integrations</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <p className="text-sm font-medium text-gray-900 mb-1">Bright Data Key</p>
                                <p className="text-xs text-gray-500 mb-3">
                                    Used for LinkedIn profile scraping (brightdata.com).
                                    {brightdataKeyIsSet && (
                                        <span className="ml-2 text-green-600 font-medium">
                                            ✓ Set: {brightdataKeyMasked}
                                        </span>
                                    )}
                                </p>
                                <div className="flex items-center space-x-2">
                                    <Input
                                        type="password"
                                        placeholder={brightdataKeyIsSet ? 'Enter new key to rotate...' : 'Paste your Bright Data key...'}
                                        value={brightdataKey}
                                        onChange={(e) => setBrightdataKey(e.target.value)}
                                        fullWidth
                                    />
                                    <Button
                                        variant="primary"
                                        onClick={handleSaveBrightdataKey}
                                        disabled={brightdataKeySaving || !brightdataKey.trim()}
                                        loading={brightdataKeySaving}
                                        className="cursor-pointer flex-shrink-0"
                                    >
                                        {brightdataKeyIsSet ? 'Rotate' : 'Save'}
                                    </Button>
                                </div>
                            </div>

                            <hr className="border-gray-100" />

                            <div>
                                <p className="text-sm font-medium text-gray-900 mb-1">Bright Data SERP Key</p>
                                <p className="text-xs text-gray-500 mb-3">
                                    Used for LinkedIn people search (zone: serp_api1).
                                    {serpKeyIsSet && (
                                        <span className="ml-2 text-green-600 font-medium">
                                            ✓ Set: {serpKeyMasked}
                                        </span>
                                    )}
                                </p>
                                <div className="flex items-center space-x-2">
                                    <Input
                                        type="password"
                                        placeholder={serpKeyIsSet ? 'Enter new key to rotate...' : 'Paste your SERP API key...'}
                                        value={serpKey}
                                        onChange={(e) => setSerpKey(e.target.value)}
                                        fullWidth
                                    />
                                    <Button
                                        variant="primary"
                                        onClick={handleSaveSerpKey}
                                        disabled={serpKeySaving || !serpKey.trim()}
                                        loading={serpKeySaving}
                                        className="cursor-pointer flex-shrink-0"
                                    >
                                        {serpKeyIsSet ? 'Rotate' : 'Save'}
                                    </Button>
                                </div>
                            </div>

                        </CardContent>
                    </Card>
                </motion.div>

                {/* API Documentation Info */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-6"
                >
                    <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="p-4">
                            <div className="flex items-start space-x-3">
                                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-blue-900 mb-1">
                                        API Documentation
                                    </p>
                                    <p className="text-sm text-blue-800">
                                        Use your API key in the <code className="px-1 py-0.5 bg-blue-100 rounded">Authorization</code> header as{' '}
                                        <code className="px-1 py-0.5 bg-blue-100 rounded">Bearer YOUR_KEY</code>.
                                        Check our API documentation for more details.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
