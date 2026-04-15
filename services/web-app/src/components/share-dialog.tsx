'use client';

import { useState } from 'react';
import { shareSession } from '@/lib/api';

interface ShareDialogProps {
    sessionId: string;
    token: string;
    onClose: () => void;
    onShared?: () => void;
}

export function ShareDialog({ sessionId, token, onClose, onShared }: ShareDialogProps) {
    const [username, setUsername] = useState('');
    const [role, setRole] = useState<'viewer' | 'collaborator'>('collaborator');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [shareLink, setShareLink] = useState('');

    const handleShare = async () => {
        if (!username.trim()) return;
        setLoading(true);
        setError('');
        try {
            const result = await shareSession(sessionId, username.trim(), role, token);
            const shareId = (result.share as any)?.share_id;
            if (shareId) {
                setShareLink(`${window.location.origin}/chat/share/${shareId}`);
            }
            onShared?.();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-semibold mb-4">Share Conversation</h2>

                <label className="block text-sm font-medium mb-1">Username (AAD Object ID)</label>
                <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="user@microsoft.com or AAD OID"
                    className="w-full px-3 py-2 border rounded-lg text-sm mb-3 dark:bg-gray-800 dark:border-gray-600"
                />

                <label className="block text-sm font-medium mb-1">Access Level</label>
                <select
                    value={role}
                    onChange={e => setRole(e.target.value as 'viewer' | 'collaborator')}
                    className="w-full px-3 py-2 border rounded-lg text-sm mb-4 dark:bg-gray-800 dark:border-gray-600"
                >
                    <option value="collaborator">Collaborator (can chat)</option>
                    <option value="viewer">Viewer (read-only)</option>
                </select>

                {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

                {shareLink && (
                    <div className="mb-3 p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm">
                        <p className="font-medium text-green-700 dark:text-green-300">Shared! Link:</p>
                        <input
                            type="text"
                            value={shareLink}
                            readOnly
                            className="w-full mt-1 px-2 py-1 bg-white dark:bg-gray-800 border rounded text-xs"
                            onClick={e => (e.target as HTMLInputElement).select()}
                        />
                    </div>
                )}

                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                        Cancel
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={loading || !username.trim()}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? 'Sharing...' : 'Share'}
                    </button>
                </div>
            </div>
        </div>
    );
}
