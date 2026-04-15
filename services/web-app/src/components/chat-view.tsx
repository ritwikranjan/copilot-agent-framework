'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMessage, type SSEEvent, type ChatMessage } from '@/lib/api';
import ReactMarkdown from 'react-markdown';

interface ChatViewProps {
    conversationId?: string;
    token: string;
    onConversationCreated?: (conversationId: string) => void;
}

export function ChatView({ conversationId, token, onConversationCreated }: ChatViewProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [activeConvId, setActiveConvId] = useState(conversationId);

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
        setStatusMessage('');

        // Use conversation ID or generate a new one
        const convId = activeConvId || `web-${Date.now()}`;
        if (!activeConvId) {
            setActiveConvId(convId);
            onConversationCreated?.(convId);
        }

        let fullContent = '';

        abortRef.current = sendMessage(userMessage, convId, token, (event: SSEEvent) => {
            switch (event.type) {
                case 'delta':
                    if (event.content) {
                        fullContent += event.content;
                        setStreamingContent(fullContent);
                    }
                    break;
                case 'message':
                    if (event.content) {
                        setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: event.content!,
                            timestamp: new Date().toISOString(),
                        }]);
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
                {messages.length === 0 && (
                    <div className="text-center text-gray-400 mt-20">
                        <h2 className="text-xl font-semibold mb-2">Copilot Chat</h2>
                        <p>Start a conversation. Your sessions sync across Teams and web.</p>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            msg.role === 'user'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                        }`}>
                            {msg.role === 'assistant' ? (
                                <div className="prose dark:prose-invert prose-sm max-w-none">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                            ) : (
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                        </div>
                    </div>
                ))}
                {/* Streaming indicator */}
                {isStreaming && streamingContent && (
                    <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 dark:bg-gray-800">
                            <div className="prose dark:prose-invert prose-sm max-w-none">
                                <ReactMarkdown>{streamingContent}</ReactMarkdown>
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
