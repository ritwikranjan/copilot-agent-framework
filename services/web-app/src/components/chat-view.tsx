'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMessage, getSessionHistory, type SSEEvent, type ChatMessage } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatViewProps {
    conversationId?: string;
    sessionId?: string;
    token: string;
    onConversationCreated?: (conversationId: string) => void;
}

export function ChatView({ conversationId, sessionId, token, onConversationCreated }: ChatViewProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [reasoningContent, setReasoningContent] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [activeConvId, setActiveConvId] = useState(conversationId);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Sync activeConvId when prop changes (session switch)
    useEffect(() => {
        setActiveConvId(conversationId);
    }, [conversationId]);

    // Load history only when switching to an existing session (sessionId provided)
    useEffect(() => {
        if (!sessionId || !token) {
            // New chat — don't clear messages, don't load history
            return;
        }

        let cancelled = false;
        setLoadingHistory(true);
        setMessages([]); // Clear for the new session being loaded

        getSessionHistory(sessionId, token)
            .then(data => {
                if (cancelled) return;
                const history: ChatMessage[] = [];
                for (const interaction of (data.interactions || []) as any[]) {
                    if (interaction.user_query) {
                        history.push({
                            role: 'user',
                            content: interaction.user_query,
                            timestamp: interaction.timestamp || '',
                        });
                    }
                    if (interaction.copilot_response) {
                        history.push({
                            role: 'assistant',
                            content: interaction.copilot_response,
                            reasoning: interaction.reasoning || undefined,
                            timestamp: interaction.timestamp || '',
                        });
                    }
                }
                setMessages(history);
            })
            .catch(err => {
                if (!cancelled) console.error('Failed to load history:', err);
            })
            .finally(() => {
                if (!cancelled) setLoadingHistory(false);
            });

        return () => { cancelled = true; };
    }, [sessionId, token]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingContent]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || isStreaming) return;

        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date().toISOString() }]);
        setIsStreaming(true);
        setStreamingContent('');
        setReasoningContent('');
        setStatusMessage('');

        // Use conversation ID or generate a new one
        const convId = activeConvId || `web-${Date.now()}`;
        if (!activeConvId) {
            setActiveConvId(convId);
            onConversationCreated?.(convId);
        }

        let fullContent = '';
        let fullReasoning = '';

        abortRef.current = sendMessage(userMessage, convId, token, (event: SSEEvent) => {
            switch (event.type) {
                case 'delta':
                    if (event.content) {
                        fullContent += event.content;
                        setStreamingContent(fullContent);
                    }
                    break;
                case 'reasoning':
                    if (event.content) {
                        fullReasoning = event.content;
                        setReasoningContent(fullReasoning);
                        setStatusMessage('Thinking...');
                    }
                    break;
                case 'message':
                    if (event.content) {
                        setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: event.content!,
                            reasoning: fullReasoning || undefined,
                            timestamp: new Date().toISOString(),
                        }]);
                        setReasoningContent('');
                    }
                    break;
                case 'status':
                    setStatusMessage(event.content || '');
                    break;
                case 'typing':
                    setStatusMessage('Thinking...');
                    break;
                case 'error':
                    setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: `⚠️ ${event.content || 'An error occurred'}`,
                        timestamp: new Date().toISOString(),
                    }]);
                    break;
                case 'done':
                    setIsStreaming(false);
                    setStreamingContent('');
                    setStatusMessage('');
                    break;
            }
        });
    }, [input, isStreaming, activeConvId, token, onConversationCreated]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loadingHistory && (
                    <div className="text-center text-gray-400 mt-10">
                        <p>Loading conversation history...</p>
                    </div>
                )}
                {!loadingHistory && messages.length === 0 && (
                    <div className="text-center text-gray-400 mt-20">
                        <h2 className="text-xl font-semibold mb-2">Copilot Chat</h2>
                        <p>Start a conversation. Your sessions sync across Teams and web.</p>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`rounded-lg px-4 py-2 ${
                            msg.role === 'user'
                                ? 'max-w-[75%] bg-blue-600 text-white'
                                : 'max-w-[92%] bg-gray-50 dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
                        }`}>
                            {msg.role === 'assistant' && msg.reasoning && (
                                <details className="mb-2">
                                    <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none">
                                        💭 Show reasoning
                                    </summary>
                                    <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded text-xs text-gray-600 dark:text-gray-300 prose dark:prose-invert prose-xs max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.reasoning}</ReactMarkdown>
                                    </div>
                                </details>
                            )}
                            {msg.role === 'assistant' ? (
                                <div className="prose dark:prose-invert prose-sm max-w-none overflow-hidden">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                </div>
                            ) : (
                                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                            )}
                        </div>
                    </div>
                ))}
                {/* Reasoning while streaming */}
                {isStreaming && reasoningContent && !streamingContent && (
                    <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                            <div className="text-xs text-amber-700 dark:text-amber-300 font-medium mb-1">💭 Thinking...</div>
                            <div className="prose dark:prose-invert prose-xs max-w-none text-amber-800 dark:text-amber-200">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningContent}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )}
                {/* Streaming indicator */}
                {isStreaming && streamingContent && (
                    <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 dark:bg-gray-800">
                            <div className="prose dark:prose-invert prose-sm max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )}
                {/* Status line */}
                {statusMessage && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 px-4">
                        {statusMessage}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                <div className="flex gap-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message..."
                        rows={1}
                        className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isStreaming}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isStreaming || !input.trim()}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}

