/**
 * Unit tests for InMemorySessionStore — direct store-level tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from './in-memory-session-store.js';
import { createSessionInfo, createSessionShare, ShareRole } from '../models.js';
import type { UserInfo, SessionInfo } from '../models.js';

describe('InMemorySessionStore', () => {
    let store: InMemorySessionStore;
    const userInfo: UserInfo = { username: 'testuser', hostname: 'test-host' };

    beforeEach(async () => {
        store = new InMemorySessionStore();
        await store.initialize();
    });

    describe('getLastSessionByConversationId', () => {
        it('should return the most recent session regardless of status', async () => {
            const older = createSessionInfo(userInfo, { conversationId: 'conv-1' });
            older.start_time = new Date('2024-01-01').toISOString();
            await store.createSession(older);

            const newer = createSessionInfo(userInfo, { conversationId: 'conv-1' });
            newer.start_time = new Date('2024-06-01').toISOString();
            newer.status = 'completed' as any;
            await store.createSession(newer);

            const result = await store.getLastSessionByConversationId('testuser', 'conv-1');
            expect(result).not.toBeNull();
            expect(result!.id).toBe(newer.id);
        });

        it('should return null when no sessions exist', async () => {
            const result = await store.getLastSessionByConversationId('testuser', 'no-conv');
            expect(result).toBeNull();
        });
    });

    describe('shareSession', () => {
        it('should store share record correctly', async () => {
            const share = createSessionShare('sess-1', 'owner', 'recipient', ShareRole.VIEWER);
            const created = await store.shareSession(share);

            expect(created.id).toBe(share.id);
            expect(created.session_id).toBe('sess-1');
            expect(created.shared_with_username).toBe('recipient');
            expect(store.getCounts().shares).toBe(1);
        });
    });

    describe('getSharedSessions', () => {
        it('should return shares for the specified user', async () => {
            const share1 = createSessionShare('sess-1', 'owner', 'alice');
            const share2 = createSessionShare('sess-2', 'owner', 'bob');
            const share3 = createSessionShare('sess-3', 'owner', 'alice');
            await store.shareSession(share1);
            await store.shareSession(share2);
            await store.shareSession(share3);

            const aliceShares = await store.getSharedSessions('alice');
            expect(aliceShares).toHaveLength(2);

            const bobShares = await store.getSharedSessions('bob');
            expect(bobShares).toHaveLength(1);
        });

        it('should return empty array for user with no shares', async () => {
            const result = await store.getSharedSessions('nobody');
            expect(result).toHaveLength(0);
        });
    });

    describe('getSessionByShareId', () => {
        it('should return the session linked by share ID', async () => {
            const session = createSessionInfo(userInfo, { conversationId: 'conv-shared' });
            await store.createSession(session);

            const share = createSessionShare(session.id, 'testuser', 'recipient');
            await store.shareSession(share);

            const found = await store.getSessionByShareId(share.share_id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(session.id);
        });

        it('should return null for unknown share ID', async () => {
            const result = await store.getSessionByShareId('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('revokeShare', () => {
        it('should remove the share and return true', async () => {
            const share = createSessionShare('sess-1', 'owner', 'recipient');
            await store.shareSession(share);
            expect(store.getCounts().shares).toBe(1);

            const result = await store.revokeShare(share.share_id);
            expect(result).toBe(true);
            expect(store.getCounts().shares).toBe(0);
        });

        it('should return false for non-existent share', async () => {
            const result = await store.revokeShare('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('getSharesForSession', () => {
        it('should return all shares for a session', async () => {
            const share1 = createSessionShare('sess-1', 'owner', 'alice');
            const share2 = createSessionShare('sess-1', 'owner', 'bob');
            const share3 = createSessionShare('sess-2', 'owner', 'alice');
            await store.shareSession(share1);
            await store.shareSession(share2);
            await store.shareSession(share3);

            const shares = await store.getSharesForSession('sess-1');
            expect(shares).toHaveLength(2);
        });
    });
});
