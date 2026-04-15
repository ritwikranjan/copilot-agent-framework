/**
 * Unit tests for API Client.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set API_URL before importing
process.env.API_URL = 'http://test-api:4000';

import {
    apiChat,
    apiGetSessionStatus,
    apiEndSession,
    apiResumeSession,
    apiGetSessions,
    apiGetSessionHistory,
} from './api-client.js';

describe('API Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('apiChat', () => {
        it('should POST to /api/chat with correct body', async () => {
            const mockResponse = new Response('data: {"type":"done"}\n\n', {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
            mockFetch.mockResolvedValue(mockResponse);

            const response = await apiChat(
                'Hello',
                { username: 'user1', hostname: 'host' },
                'conv-1'
            );

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/chat',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: 'Hello',
                        userInfo: { username: 'user1', hostname: 'host' },
                        conversationId: 'conv-1',
                    }),
                })
            );
            expect(response.status).toBe(200);
        });

        it('should propagate network errors', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));
            await expect(apiChat('Hi', { username: 'u', hostname: 'h' })).rejects.toThrow('Network error');
        });
    });

    describe('apiGetSessionStatus', () => {
        it('should GET session status with correct params', async () => {
            mockFetch.mockResolvedValue(new Response(JSON.stringify({
                exists: true,
                expired: false,
                remainingTimeMs: 3600000,
            }), { status: 200 }));

            const status = await apiGetSessionStatus('conv-1', 'user1');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/sessions/status?username=user1&conversationId=conv-1'
            );
            expect(status.exists).toBe(true);
            expect(status.expired).toBe(false);
        });

        it('should throw on non-OK response', async () => {
            mockFetch.mockResolvedValue(new Response('Bad request', { status: 400 }));
            await expect(apiGetSessionStatus('c', 'u')).rejects.toThrow('API returned 400');
        });
    });

    describe('apiEndSession', () => {
        it('should POST to end session', async () => {
            mockFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

            const result = await apiEndSession('sess-1', 'user1');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/sessions/sess-1/end',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ username: 'user1' }),
                })
            );
            expect(result.success).toBe(true);
        });
    });

    describe('apiResumeSession', () => {
        it('should POST to resume session', async () => {
            mockFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, session: {} }), { status: 200 }));

            const result = await apiResumeSession('user1', 'conv-1');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/sessions/_/resume',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ username: 'user1', conversationId: 'conv-1' }),
                })
            );
            expect(result.success).toBe(true);
        });
    });

    describe('apiGetSessions', () => {
        it('should GET sessions list', async () => {
            mockFetch.mockResolvedValue(new Response(JSON.stringify({ own: [{ id: 's1' }], shared: [] }), { status: 200 }));

            const result = await apiGetSessions('user1');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/sessions?username=user1'
            );
            expect(result.own).toHaveLength(1);
        });
    });

    describe('apiGetSessionHistory', () => {
        it('should GET session history', async () => {
            mockFetch.mockResolvedValue(new Response(JSON.stringify({ interactions: [] }), { status: 200 }));

            const result = await apiGetSessionHistory('sess-1', 'user1');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://test-api:4000/api/sessions/sess-1/history?username=user1'
            );
            expect(result.interactions).toHaveLength(0);
        });
    });
});
