/**
 * Unit tests for SessionManager.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager, SessionNotFoundError, SessionExpiredError, SessionNameConflictError } from './session-manager.js';
import { InMemorySessionStore } from './stores/in-memory-session-store.js';
import { SessionStatus, SESSION_EXPIRATION_MS } from './models.js';
import type { UserInfo } from './models.js';

describe('SessionManager', () => {
    let store: InMemorySessionStore;
    let manager: SessionManager;

    const userInfo: UserInfo = {
        username: 'testuser',
        hostname: 'test-host'
    };

    beforeEach(() => {
        store = new InMemorySessionStore();
        manager = new SessionManager({ store });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('resolveSession - create new session', () => {
        it('should create a new unnamed session when no options provided', async () => {
            const result = await manager.resolveSession(userInfo);

            expect(result.isNew).toBe(true);
            expect(result.session.user_info).toEqual(userInfo);
            expect(result.session.status).toBe(SessionStatus.ACTIVE);
            expect(result.session.name).toBeUndefined();
        });

        it('should create a new session with conversationId when no existing session', async () => {
            const result = await manager.resolveSession(userInfo, {
                conversationId: 'conv-new'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.conversation_id).toBe('conv-new');
        });

        it('should create a new session with a name', async () => {
            const result = await manager.resolveSession(userInfo, {
                sessionName: 'my-session'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.name).toBe('my-session');
        });

        it('should create a session with agentConfig and copilotSessionId', async () => {
            const result = await manager.resolveSession(userInfo, {
                agentConfig: { model: 'gpt-5' },
                copilotSessionId: 'cplt-123'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.agent_config).toEqual({ model: 'gpt-5' });
            expect(result.session.copilot_session_id).toBe('cplt-123');
        });
    });

    describe('resolveSession - resume by conversationId', () => {
        it('should resume an existing session by conversationId', async () => {
            const created = await manager.resolveSession(userInfo, {
                conversationId: 'conv-100'
            });

            const resumed = await manager.resolveSession(userInfo, {
                conversationId: 'conv-100'
            });

            expect(resumed.isNew).toBe(false);
            expect(resumed.session.id).toBe(created.session.id);
        });

        it('should create new session if existing session for conversationId is expired', async () => {
            vi.useFakeTimers();

            const created = await manager.resolveSession(userInfo, {
                conversationId: 'conv-exp'
            });

            // Advance past expiration
            vi.advanceTimersByTime(SESSION_EXPIRATION_MS + 1000);

            const result = await manager.resolveSession(userInfo, {
                conversationId: 'conv-exp'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.id).not.toBe(created.session.id);
        });
    });

    describe('resolveSession - resume by sessionId', () => {
        it('should resume an existing session by sessionId', async () => {
            const created = await manager.resolveSession(userInfo);

            const resumed = await manager.resolveSession(userInfo, {
                sessionId: created.session.id
            });

            expect(resumed.isNew).toBe(false);
            expect(resumed.session.id).toBe(created.session.id);
        });

        it('should throw SessionNotFoundError for unknown sessionId', async () => {
            await expect(
                manager.resolveSession(userInfo, { sessionId: 'nonexistent' })
            ).rejects.toThrow(SessionNotFoundError);
        });

        it('should throw SessionExpiredError for expired session', async () => {
            vi.useFakeTimers();

            const created = await manager.resolveSession(userInfo);

            vi.advanceTimersByTime(SESSION_EXPIRATION_MS + 1000);

            await expect(
                manager.resolveSession(userInfo, { sessionId: created.session.id })
            ).rejects.toThrow(SessionExpiredError);
        });
    });

    describe('resolveSession - resume by sessionName', () => {
        it('should resume an existing session by name', async () => {
            const created = await manager.resolveSession(userInfo, {
                sessionName: 'named-session'
            });

            const resumed = await manager.resolveSession(userInfo, {
                sessionName: 'named-session'
            });

            expect(resumed.isNew).toBe(false);
            expect(resumed.session.id).toBe(created.session.id);
        });

        it('should create new session if named session is expired', async () => {
            vi.useFakeTimers();

            const created = await manager.resolveSession(userInfo, {
                sessionName: 'expiring-session'
            });

            vi.advanceTimersByTime(SESSION_EXPIRATION_MS + 1000);

            const result = await manager.resolveSession(userInfo, {
                sessionName: 'expiring-session'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.id).not.toBe(created.session.id);
        });
    });

    describe('getSessionStatus', () => {
        it('should return exists=false for no session', async () => {
            const status = await manager.getSessionStatus('testuser', 'no-conv');

            expect(status.exists).toBe(false);
            expect(status.expired).toBe(false);
        });

        it('should return active session status', async () => {
            await manager.resolveSession(userInfo, { conversationId: 'conv-status' });

            const status = await manager.getSessionStatus('testuser', 'conv-status');

            expect(status.exists).toBe(true);
            expect(status.expired).toBe(false);
            expect(status.remainingTimeMs).toBeGreaterThan(0);
            expect(status.createdAt).toBeInstanceOf(Date);
            expect(status.copilotSessionId).toBeUndefined();
        });

        it('should return expired status for expired session', async () => {
            vi.useFakeTimers();

            await manager.resolveSession(userInfo, { conversationId: 'conv-expire' });

            vi.advanceTimersByTime(SESSION_EXPIRATION_MS + 1000);

            // getSessionStatus uses getSessionByConversationId, which in InMemorySessionStore
            // filters out expired sessions, so it returns exists=false
            const status = await manager.getSessionStatus('testuser', 'conv-expire');
            expect(status.exists).toBe(false);
        });
    });

    describe('updateCopilotSessionId', () => {
        it('should update the copilot session ID', async () => {
            const { session } = await manager.resolveSession(userInfo);

            const updated = await manager.updateCopilotSessionId(
                'testuser',
                session.id,
                'new-copilot-id'
            );

            expect(updated.copilot_session_id).toBe('new-copilot-id');
            expect(updated.last_activity_at).toBeDefined();
        });

        it('should throw SessionNotFoundError for unknown session', async () => {
            await expect(
                manager.updateCopilotSessionId('testuser', 'nonexistent', 'cplt-id')
            ).rejects.toThrow(SessionNotFoundError);
        });
    });

    describe('touchSession', () => {
        it('should update last_activity_at', async () => {
            vi.useFakeTimers();
            const { session } = await manager.resolveSession(userInfo);
            const originalActivity = session.last_activity_at;

            vi.advanceTimersByTime(60_000); // 1 minute

            const touched = await manager.touchSession('testuser', session.id);

            expect(touched).not.toBeNull();
            expect(touched!.last_activity_at).not.toBe(originalActivity);
        });

        it('should return null for nonexistent session', async () => {
            const result = await manager.touchSession('testuser', 'nonexistent');
            expect(result).toBeNull();
        });

        it('should return null for expired session', async () => {
            vi.useFakeTimers();
            const { session } = await manager.resolveSession(userInfo);

            vi.advanceTimersByTime(SESSION_EXPIRATION_MS + 1000);

            const result = await manager.touchSession('testuser', session.id);
            expect(result).toBeNull();
        });
    });

    describe('renameSession', () => {
        it('should rename a session', async () => {
            const { session } = await manager.resolveSession(userInfo);

            const renamed = await manager.renameSession('testuser', session.id, 'new-name');

            expect(renamed.name).toBe('new-name');
        });

        it('should throw SessionNotFoundError for unknown session', async () => {
            await expect(
                manager.renameSession('testuser', 'nonexistent', 'name')
            ).rejects.toThrow(SessionNotFoundError);
        });

        it('should throw SessionNameConflictError for duplicate names', async () => {
            const { session: s1 } = await manager.resolveSession(userInfo, {
                sessionName: 'taken-name'
            });
            const { session: s2 } = await manager.resolveSession(userInfo);

            await expect(
                manager.renameSession('testuser', s2.id, 'taken-name')
            ).rejects.toThrow(SessionNameConflictError);
        });

        it('should allow renaming to the same name (no-op)', async () => {
            const { session } = await manager.resolveSession(userInfo, {
                sessionName: 'keep-name'
            });

            const renamed = await manager.renameSession('testuser', session.id, 'keep-name');
            expect(renamed.name).toBe('keep-name');
        });
    });

    describe('endSession', () => {
        it('should end a session with COMPLETED status', async () => {
            const { session } = await manager.resolveSession(userInfo);

            const ended = await manager.endSession('testuser', session.id);

            expect(ended.status).toBe(SessionStatus.COMPLETED);
            expect(ended.end_time).toBeDefined();
            expect(ended.copilot_session_id).toBeUndefined();
        });

        it('should end a session with ERROR status', async () => {
            const { session } = await manager.resolveSession(userInfo);

            const ended = await manager.endSession('testuser', session.id, SessionStatus.ERROR);

            expect(ended.status).toBe(SessionStatus.ERROR);
        });

        it('should throw SessionNotFoundError for unknown session', async () => {
            await expect(
                manager.endSession('testuser', 'nonexistent')
            ).rejects.toThrow(SessionNotFoundError);
        });
    });

    describe('endSessionByConversationId', () => {
        it('should end session by conversation ID', async () => {
            await manager.resolveSession(userInfo, { conversationId: 'conv-end' });

            const ended = await manager.endSessionByConversationId('testuser', 'conv-end');

            expect(ended).not.toBeNull();
            expect(ended!.status).toBe(SessionStatus.COMPLETED);
            expect(ended!.end_time).toBeDefined();
        });

        it('should return null for unknown conversation ID', async () => {
            const result = await manager.endSessionByConversationId('testuser', 'no-conv');

            expect(result).toBeNull();
        });
    });

    describe('custom sessionExpirationMs', () => {
        it('should use custom expiration when configured on SessionManager', async () => {
            const customMs = 2 * 60 * 60 * 1000; // 2 hours
            const customManager = new SessionManager({
                store,
                sessionExpirationMs: customMs
            });

            const before = Date.now();
            const { session } = await customManager.resolveSession(userInfo, {
                conversationId: 'conv-custom-exp'
            });
            const after = Date.now();

            const expiresAt = new Date(session.expires_at!).getTime();
            expect(expiresAt).toBeGreaterThanOrEqual(before + customMs);
            expect(expiresAt).toBeLessThanOrEqual(after + customMs);
        });

        it('should expire session after custom duration', async () => {
            vi.useFakeTimers();
            const customMs = 2 * 60 * 60 * 1000; // 2 hours
            const customManager = new SessionManager({
                store,
                sessionExpirationMs: customMs
            });

            const created = await customManager.resolveSession(userInfo, {
                conversationId: 'conv-custom-exp2'
            });

            // Advance past custom expiration
            vi.advanceTimersByTime(customMs + 1000);

            const result = await customManager.resolveSession(userInfo, {
                conversationId: 'conv-custom-exp2'
            });

            expect(result.isNew).toBe(true);
            expect(result.session.id).not.toBe(created.session.id);
        });
    });
});
