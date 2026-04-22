'use client';

import { useState, useEffect } from 'react';
import { getSessions, type SessionInfo } from '@/lib/api';

interface SessionListProps {
    token: string;
    activeSessionId?: string;
    onSelectSession: (session: SessionInfo) => void;
    onNewChat: () => void;
    refreshTrigger?: number;
}

export function SessionList({ token, activeSessionId, onSelectSession, onNewChat, refreshTrigger }: SessionListProps) {
    const [ownSessions, setOwnSessions] = useState<SessionInfo[]>([]);
    const [sharedSessions, setSharedSessions] = useState<Array<{ share: unknown; session: SessionInfo }>>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const data = await getSessions(token);
                setOwnSessions(data.own);
                setSharedSessions(data.shared);
            } catch (err) {
                console.error('Failed to load sessions:', err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [token, refreshTrigger]);

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        if (diffMs < 60000) return 'just now';
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
        return d.toLocaleDateString();
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={onNewChat}
                    className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                    + New Chat
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {loading && <p className="text-sm text-gray-500 p-3">Loading...</p>}

                {!loading && ownSessions.length === 0 && sharedSessions.length === 0 && (
                    <p className="text-sm text-gray-400 p-3 text-center">No conversations yet</p>
                )}

                {ownSessions.length > 0 && (
                    <div className="p-2">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-1">Your Sessions</h3>
                        {ownSessions.map(s => (
                            <button
                                key={s.id}
                                onClick={() => onSelectSession(s)}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
                                    activeSessionId === s.id
                                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                <div className="font-medium truncate">
                                    {s.name || s.conversation_id || s.id.slice(0, 8)}
                                </div>
                                <div className="text-xs text-gray-400">
                                    {formatTime(s.last_activity_at || s.start_time)}
                                    {s.is_shared && ' · 🔗 shared'}
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {sharedSessions.length > 0 && (
                    <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-1">Shared With You</h3>
                        {sharedSessions.map(({ session: s }) => (
                            <button
                                key={s.id}
                                onClick={() => onSelectSession(s)}
                                className="w-full text-left px-3 py-2 rounded-md text-sm truncate hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                <div className="font-medium truncate text-gray-700 dark:text-gray-300">
                                    🔗 {s.name || s.conversation_id || s.id.slice(0, 8)}
                                </div>
                                <div className="text-xs text-gray-400">
                                    {formatTime(s.last_activity_at || s.start_time)}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
