'use client';

import { useEffect, useState, useCallback } from 'react';
import { getMsalInstance, loginRequest } from '@/lib/msal';
import { ChatView } from '@/components/chat-view';
import { SessionList } from '@/components/session-list';
import { ShareDialog } from '@/components/share-dialog';
import type { SessionInfo } from '@/lib/api';
import type { AccountInfo } from '@azure/msal-browser';

/**
 * Main chat page — supports:
 * - /chat — new conversation
 * - /chat/:sessionId — existing conversation
 * - /chat/share/:shareId — shared conversation (handled via query params)
 */
export default function ChatPage({ params }: { params: Promise<{ id?: string[] }> }) {
    const [account, setAccount] = useState<AccountInfo | null>(null);
    const [token, setToken] = useState('');
    const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const [chatKey, setChatKey] = useState(0);
    const [showShare, setShowShare] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [loading, setLoading] = useState(true);

    // Initialize MSAL + get token
    useEffect(() => {
        async function init() {
            try {
                const msalInstance = getMsalInstance();
                await msalInstance.initialize();
                await msalInstance.handleRedirectPromise();
                const accounts = msalInstance.getAllAccounts();
                if (accounts.length === 0) {
                    window.location.href = '/';
                    return;
                }
                setAccount(accounts[0]);

                const tokenResponse = await msalInstance.acquireTokenSilent({
                    ...loginRequest,
                    account: accounts[0],
                });
                setToken(tokenResponse.idToken);
            } catch (err) {
                console.error('Auth error:', err);
                window.location.href = '/';
            } finally {
                setLoading(false);
            }
        }
        init();
    }, []);

    // Set conversation ID from URL params
    useEffect(() => {
        params.then(p => {
            if (p.id && p.id.length > 0) {
                setConversationId(p.id.join('/'));
            }
        });
    }, [params]);

    const handleSelectSession = useCallback((session: SessionInfo) => {
        setActiveSession(session);
        setConversationId(session.conversation_id || session.id);
        setChatKey(prev => prev + 1); // Force remount ChatView
    }, []);

    const handleNewChat = useCallback(() => {
        setActiveSession(null);
        setConversationId(undefined);
        setChatKey(prev => prev + 1); // Force remount ChatView
    }, []);

    const handleConversationCreated = useCallback((convId: string) => {
        // Don't change chatKey here — keep the current ChatView alive
        setConversationId(convId);
        setRefreshTrigger(prev => prev + 1);
    }, []);

    if (loading || !token) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-gray-500">Authenticating...</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <div className="w-72 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
                <SessionList
                    token={token}
                    activeSessionId={activeSession?.id}
                    onSelectSession={handleSelectSession}
                    onNewChat={handleNewChat}
                    refreshTrigger={refreshTrigger}
                />
            </div>

            {/* Main chat area */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
                    <div className="text-sm font-medium">
                        {activeSession?.name || conversationId || 'New Conversation'}
                    </div>
                    <div className="flex items-center gap-2">
                        {activeSession && (
                            <button
                                onClick={() => setShowShare(true)}
                                className="text-sm px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                🔗 Share
                            </button>
                        )}
                        <span className="text-xs text-gray-400">
                            {account?.name || account?.username}
                        </span>
                    </div>
                </div>

                {/* Chat — key only changes on explicit session switch, not mid-conversation */}
                <ChatView
                    key={chatKey}
                    conversationId={conversationId}
                    sessionId={activeSession?.id}
                    token={token}
                    onConversationCreated={handleConversationCreated}
                />
            </div>

            {/* Share Dialog */}
            {showShare && activeSession && (
                <ShareDialog
                    sessionId={activeSession.id}
                    token={token}
                    onClose={() => setShowShare(false)}
                    onShared={() => setRefreshTrigger(prev => prev + 1)}
                />
            )}
        </div>
    );
}
