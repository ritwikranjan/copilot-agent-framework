/**
 * Unit tests for auth middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToken } from './auth';

// Helper: create a mock JWT with given payload
function createMockJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = 'mock-signature';
    return `${header}.${body}.${signature}`;
}

describe('validateToken', () => {
    beforeEach(() => {
        // Clear env for isolated tests
        process.env.ENTRA_TENANT_ID = 'test-tenant-id';
        process.env.ENTRA_CLIENT_ID = 'test-client-id';
    });

    it('should return 401 for missing Authorization header', async () => {
        const result = await validateToken(null);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
            expect(result.error).toContain('Missing');
        }
    });

    it('should return 401 for non-Bearer header', async () => {
        const result = await validateToken('Basic abc123');
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
        }
    });

    it('should return 401 for invalid token format', async () => {
        const result = await validateToken('Bearer not-a-jwt');
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
            expect(result.error).toContain('Invalid token format');
        }
    });

    it('should return 401 for expired token', async () => {
        const token = createMockJwt({
            oid: 'user-oid',
            tid: 'test-tenant-id',
            aud: 'test-client-id',
            exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
            name: 'Test User',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
            expect(result.error).toContain('expired');
        }
    });

    it('should return 403 for wrong tenant', async () => {
        const token = createMockJwt({
            oid: 'user-oid',
            tid: 'wrong-tenant-id',
            aud: 'test-client-id',
            exp: Math.floor(Date.now() / 1000) + 3600,
            name: 'Test User',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(403);
            expect(result.error).toContain('microsoft.com');
        }
    });

    it('should return 401 for wrong audience', async () => {
        const token = createMockJwt({
            oid: 'user-oid',
            tid: 'test-tenant-id',
            aud: 'wrong-client-id',
            exp: Math.floor(Date.now() / 1000) + 3600,
            name: 'Test User',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
            expect(result.error).toContain('audience');
        }
    });

    it('should return 401 for missing oid claim', async () => {
        const token = createMockJwt({
            tid: 'test-tenant-id',
            aud: 'test-client-id',
            exp: Math.floor(Date.now() / 1000) + 3600,
            name: 'Test User',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.status).toBe(401);
            expect(result.error).toContain('oid');
        }
    });

    it('should return user for valid token', async () => {
        const token = createMockJwt({
            oid: 'user-oid-123',
            tid: 'test-tenant-id',
            aud: 'test-client-id',
            exp: Math.floor(Date.now() / 1000) + 3600,
            name: 'Test User',
            preferred_username: 'test@microsoft.com',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('user' in result).toBe(true);
        if ('user' in result) {
            expect(result.user.oid).toBe('user-oid-123');
            expect(result.user.name).toBe('Test User');
            expect(result.user.email).toBe('test@microsoft.com');
            expect(result.user.tid).toBe('test-tenant-id');
        }
    });

    it('should accept api:// audience format', async () => {
        const token = createMockJwt({
            oid: 'user-oid',
            tid: 'test-tenant-id',
            aud: 'api://test-client-id',
            exp: Math.floor(Date.now() / 1000) + 3600,
            name: 'Test',
        });
        const result = await validateToken(`Bearer ${token}`);
        expect('user' in result).toBe(true);
    });
});
