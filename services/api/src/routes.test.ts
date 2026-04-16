/**
 * Unit tests for session and sharing routes.
 * Uses InMemoryStores — no mocking of CopilotService needed for session CRUD.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock @github/copilot-sdk before any imports that use it
vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
}));

// Mock telemetry (imports Azure Monitor which isn't available in tests)
vi.mock('../telemetry.js', () => ({
    trackSession: vi.fn(),
    trackShare: vi.fn(),
    trackError: vi.fn(),
    trackRequest: vi.fn(),
    trackChat: vi.fn(),
    trackChatLatency: vi.fn(),
}));

import {
    SessionManager,
    AuditManager,
    InMemorySessionStore,
    InMemoryAuditStore,
    ShareRole,
} from '@ritwikranjan/copilot-agent-framework';
import type { UserInfo } from '@ritwikranjan/copilot-agent-framework';
import { createSessionsRouter } from './routes/sessions.js';
import { createSharingRouter } from './routes/sharing.js';

function createTestApp() {
    const sessionStore = new InMemorySessionStore();
    const auditStore = new InMemoryAuditStore();
    const sessionManager = new SessionManager({ store: sessionStore });

    const app = express();
    app.use(express.json());
    app.use('/api/sessions', createSessionsRouter(() => sessionManager, () => auditStore));
    app.use('/api/sessions', createSharingRouter(() => sessionManager));

    return { app, sessionManager, sessionStore };
}

const userInfo: UserInfo = { username: 'testuser', hostname: 'test-host' };

describe('Sessions Routes', () => {
    let app: express.Express;
    let sessionManager: SessionManager;

    beforeEach(() => {
        const ctx = createTestApp();
        app = ctx.app;
        sessionManager = ctx.sessionManager;
    });

    describe('GET /api/sessions', () => {
        it('should return empty sessions for new user', async () => {
            const res = await request(app).get('/api/sessions?username=testuser');
            expect(res.status).toBe(200);
            expect(res.body.own).toHaveLength(0);
            expect(res.body.shared).toHaveLength(0);
        });

        it('should return 400 without username', async () => {
            const res = await request(app).get('/api/sessions');
            expect(res.status).toBe(400);
        });

        it('should return user sessions', async () => {
            await sessionManager.resolveSession(userInfo, { conversationId: 'conv-1' });
            const res = await request(app).get('/api/sessions?username=testuser');
            expect(res.status).toBe(200);
            expect(res.body.own).toHaveLength(1);
        });
    });

    describe('GET /api/sessions/status', () => {
        it('should return session status', async () => {
            await sessionManager.resolveSession(userInfo, { conversationId: 'conv-status' });
            const res = await request(app).get('/api/sessions/status?username=testuser&conversationId=conv-status');
            expect(res.status).toBe(200);
            expect(res.body.exists).toBe(true);
            expect(res.body.expired).toBe(false);
        });

        it('should return 400 without params', async () => {
            const res = await request(app).get('/api/sessions/status');
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/sessions/:id/end', () => {
        it('should end a session', async () => {
            const { session } = await sessionManager.resolveSession(userInfo, { conversationId: 'conv-end' });
            const res = await request(app)
                .post(`/api/sessions/${session.id}/end`)
                .send({ username: 'testuser' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should return 404 for unknown session', async () => {
            const res = await request(app)
                .post('/api/sessions/nonexistent/end')
                .send({ username: 'testuser' });
            expect(res.status).toBe(404);
        });
    });
});

describe('Sharing Routes', () => {
    let app: express.Express;
    let sessionManager: SessionManager;

    beforeEach(() => {
        const ctx = createTestApp();
        app = ctx.app;
        sessionManager = ctx.sessionManager;
    });

    describe('POST /api/sessions/:id/share', () => {
        it('should share a session', async () => {
            const { session } = await sessionManager.resolveSession(userInfo, { conversationId: 'conv-share' });
            const res = await request(app)
                .post(`/api/sessions/${session.id}/share`)
                .send({ ownerUsername: 'testuser', sharedWith: 'otheruser', role: 'viewer' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.share.shared_with_username).toBe('otheruser');
            expect(res.body.share.role).toBe('viewer');
        });

        it('should return 404 for non-existent session', async () => {
            const res = await request(app)
                .post('/api/sessions/nonexistent/share')
                .send({ ownerUsername: 'testuser', sharedWith: 'other' });
            expect(res.status).toBe(404);
        });

        it('should return 403 for non-owner', async () => {
            const otherUser: UserInfo = { username: 'otheruser', hostname: 'other' };
            const { session } = await sessionManager.resolveSession(otherUser, { conversationId: 'conv-x' });
            const res = await request(app)
                .post(`/api/sessions/${session.id}/share`)
                .send({ ownerUsername: 'testuser', sharedWith: 'anyone' });
            expect(res.status).toBe(404); // testuser can't find the session (partition key mismatch)
        });
    });

    describe('GET /api/sessions/shared', () => {
        it('should return shared sessions for user', async () => {
            const { session } = await sessionManager.resolveSession(userInfo, { conversationId: 'conv-s' });
            await sessionManager.shareSession(session.id, 'testuser', 'recipient', ShareRole.VIEWER);

            const res = await request(app).get('/api/sessions/shared?username=recipient');
            expect(res.status).toBe(200);
            expect(res.body.shared).toHaveLength(1);
        });
    });

    describe('GET /api/sessions/share/:shareId', () => {
        it('should access session via share link', async () => {
            const { session } = await sessionManager.resolveSession(userInfo, { conversationId: 'conv-link' });
            const share = await sessionManager.shareSession(session.id, 'testuser', 'other', ShareRole.COLLABORATOR);

            const res = await request(app).get(`/api/sessions/share/${share.share_id}`);
            expect(res.status).toBe(200);
            expect(res.body.session.id).toBe(session.id);
        });

        it('should return 404 for unknown share link', async () => {
            const res = await request(app).get('/api/sessions/share/unknown');
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /api/sessions/:id/share/:shareId', () => {
        it('should revoke a share', async () => {
            const { session } = await sessionManager.resolveSession(userInfo, { conversationId: 'conv-rev' });
            const share = await sessionManager.shareSession(session.id, 'testuser', 'other');

            const res = await request(app)
                .delete(`/api/sessions/${session.id}/share/${share.share_id}`)
                .send({ ownerUsername: 'testuser' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify share is gone
            const checkRes = await request(app).get(`/api/sessions/share/${share.share_id}`);
            expect(checkRes.status).toBe(404);
        });
    });
});
