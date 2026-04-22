/**
 * Unit tests for browser API client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock performance
vi.stubGlobal('performance', {
    now: vi.fn(() => Date.now()),
});

import { getSessions, getSessionHistory, shareSession } from './api';

describe('API Client (browser)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getSessions', () => {
        it('should fetch sessions with auth header', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ own: [{ id: 's1' }], shared: [] }),
            });

            const result = await getSessions('test-token');

            expect(mockFetch).toHaveBeenCalledWith('/api/sessions', {
                headers: { 'Authorization': 'Bearer test-token' },
            });
            expect(result.own).toHaveLength(1);
        });

        it('should throw on non-OK response', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 401 });
            await expect(getSessions('bad-token')).rejects.toThrow('401');
        });
    });

    describe('getSessionHistory', () => {
        it('should fetch history with auth header', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ interactions: [{ id: 'i1' }] }),
            });

            const result = await getSessionHistory('sess-1', 'token');

            expect(mockFetch).toHaveBeenCalledWith('/api/sessions?action=history&id=sess-1', {
                headers: { 'Authorization': 'Bearer token' },
            });
            expect(result.interactions).toHaveLength(1);
        });
    });

    describe('shareSession', () => {
        it('should POST share with correct payload', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, share: { share_id: 'abc' } }),
            });

            const result = await shareSession('sess-1', 'other-user', 'collaborator', 'token');

            expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-1/share', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer token',
                },
                body: JSON.stringify({ sharedWith: 'other-user', role: 'collaborator' }),
            });
            expect(result.success).toBe(true);
        });
    });
});
