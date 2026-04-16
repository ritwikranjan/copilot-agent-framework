/**
 * Session routes — /api/sessions
 *
 * CRUD operations for sessions. No auth — trusts VNet callers.
 * Username is passed as a query parameter or in the request body.
 */

import { Router, type Request, type Response } from 'express';
import type { SessionManager } from '@ritwikranjan/copilot-agent-framework';
import type { IAuditStore } from '@ritwikranjan/copilot-agent-framework';
import { trackSession, trackError } from '../telemetry.js';

export function createSessionsRouter(
    getSessionManager: () => SessionManager,
    getAuditStore: () => IAuditStore | null
): Router {
    const router = Router();

    /** GET /api/sessions?username= — list user's sessions + shared */
    router.get('/', async (req: Request, res: Response) => {
        const username = req.query.username as string;
        if (!username) {
            res.status(400).json({ error: 'Missing required query param: username' });
            return;
        }

        try {
            const result = await getSessionManager().getAccessibleSessions(username);
            console.log(`[Sessions] GET /api/sessions user=${username} own=${result.own.length} shared=${result.shared.length}`);
            res.json(result);
        } catch (error) {
            trackError('sessions_list', '/api/sessions');
            console.error('[Sessions] Error listing sessions:', (error as Error).message);
            res.status(500).json({ error: 'Failed to list sessions' });
        }
    });

    /** GET /api/sessions/:id/history?username= — get conversation interactions */
    router.get('/:id/history', async (req: Request, res: Response) => {
        const sessionId = req.params.id;
        const username = req.query.username as string;
        if (!username) {
            res.status(400).json({ error: 'Missing required query param: username' });
            return;
        }

        try {
            // Check access
            const access = await getSessionManager().canAccessSession(sessionId, username);
            if (!access) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const auditStore = getAuditStore();
            if (!auditStore) {
                res.json({ interactions: [] });
                return;
            }

            await auditStore.initialize();
            const interactions = await auditStore.getInteractionsBySession(sessionId);
            console.log(`[Sessions] GET /api/sessions/${sessionId}/history user=${username} interactions=${interactions.length}`);
            res.json({ interactions });
        } catch (error) {
            trackError('session_history', `/api/sessions/${sessionId}/history`);
            console.error('[Sessions] Error getting history:', (error as Error).message);
            res.status(500).json({ error: 'Failed to get session history' });
        }
    });

    /** POST /api/sessions/:id/end — end a session */
    router.post('/:id/end', async (req: Request, res: Response) => {
        const sessionId = req.params.id;
        const { username } = req.body as { username?: string };
        if (!username) {
            res.status(400).json({ error: 'Missing required field: username' });
            return;
        }

        try {
            const session = await getSessionManager().endSession(username, sessionId);
            trackSession('end');
            console.log(`[Sessions] POST /api/sessions/${sessionId}/end user=${username}`);
            res.json({ success: true, session });
        } catch (error) {
            if ((error as Error).name === 'SessionNotFoundError') {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            trackError('session_end', `/api/sessions/${sessionId}/end`);
            res.status(500).json({ error: 'Failed to end session' });
        }
    });

    /** POST /api/sessions/:id/resume — reactivate an expired session */
    router.post('/:id/resume', async (req: Request, res: Response) => {
        const { username, conversationId } = req.body as { username?: string; conversationId?: string };
        if (!username || !conversationId) {
            res.status(400).json({ error: 'Missing required fields: username, conversationId' });
            return;
        }

        try {
            const session = await getSessionManager().reactivateSession(username, conversationId);
            if (!session) {
                res.status(404).json({ error: 'No session found to resume' });
                return;
            }
            trackSession('resume');
            console.log(`[Sessions] POST /api/sessions/resume user=${username} conv=${conversationId}`);
            res.json({ success: true, session });
        } catch (error) {
            trackError('session_resume', '/api/sessions/resume');
            res.status(500).json({ error: 'Failed to resume session' });
        }
    });

    /** GET /api/sessions/status?username=&conversationId= — get session status */
    router.get('/status', async (req: Request, res: Response) => {
        const username = req.query.username as string;
        const conversationId = req.query.conversationId as string;
        if (!username || !conversationId) {
            res.status(400).json({ error: 'Missing required query params: username, conversationId' });
            return;
        }

        try {
            const status = await getSessionManager().getSessionStatus(username, conversationId);
            res.json(status);
        } catch (error) {
            trackError('session_status', '/api/sessions/status');
            res.status(500).json({ error: 'Failed to get session status' });
        }
    });

    return router;
}
