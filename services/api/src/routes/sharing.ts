/**
 * Sharing routes — /api/sessions/:id/share, /api/sessions/shared, /api/sessions/share/:shareId
 */

import { Router, type Request, type Response } from 'express';
import type { SessionManager } from '@ritwikranjan/copilot-agent-framework';
import { trackShare, trackError } from '../telemetry.js';

export function createSharingRouter(getSessionManager: () => SessionManager): Router {
    const router = Router();

    /** POST /api/sessions/:id/share — share a session */
    router.post('/:id/share', async (req: Request, res: Response) => {
        const sessionId = req.params.id;
        const { ownerUsername, sharedWith, role } = req.body as {
            ownerUsername?: string;
            sharedWith?: string;
            role?: string;
        };

        if (!ownerUsername || !sharedWith) {
            res.status(400).json({ error: 'Missing required fields: ownerUsername, sharedWith' });
            return;
        }

        // Use string values directly to avoid enum import resolution issues
        const shareRole = role === 'viewer' ? 'viewer' : 'collaborator';

        try {
            const share = await getSessionManager().shareSession(
                sessionId, ownerUsername, sharedWith, shareRole as any
            );
            trackShare('create');
            console.log(`[Sharing] POST share session=${sessionId} with=${sharedWith} role=${shareRole}`);
            res.json({ success: true, share });
        } catch (error) {
            if ((error as Error).name === 'SessionNotFoundError') {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if ((error as Error).message.includes('not the owner')) {
                res.status(403).json({ error: 'Only the session owner can share' });
                return;
            }
            trackError('share_create', `/api/sessions/${sessionId}/share`);
            console.error('[Sharing] Error:', (error as Error).message);
            res.status(500).json({ error: 'Failed to share session' });
        }
    });

    /** DELETE /api/sessions/:id/share/:shareId — revoke a share */
    router.delete('/:id/share/:shareId', async (req: Request, res: Response) => {
        const shareId = req.params.shareId;
        const { ownerUsername } = req.body as { ownerUsername?: string };

        if (!ownerUsername) {
            res.status(400).json({ error: 'Missing required field: ownerUsername' });
            return;
        }

        try {
            const revoked = await getSessionManager().revokeShare(shareId, ownerUsername);
            if (!revoked) {
                res.status(404).json({ error: 'Share not found' });
                return;
            }
            trackShare('revoke');
            console.log(`[Sharing] DELETE share=${shareId} by=${ownerUsername}`);
            res.json({ success: true });
        } catch (error) {
            if ((error as Error).message.includes('not the owner')) {
                res.status(403).json({ error: 'Only the session owner can revoke shares' });
                return;
            }
            trackError('share_revoke', `/api/sessions/share/${shareId}`);
            res.status(500).json({ error: 'Failed to revoke share' });
        }
    });

    /** GET /api/sessions/shared?username= — get sessions shared with user */
    router.get('/shared', async (req: Request, res: Response) => {
        const username = req.query.username as string;
        if (!username) {
            res.status(400).json({ error: 'Missing required query param: username' });
            return;
        }

        try {
            const result = await getSessionManager().getAccessibleSessions(username);
            console.log(`[Sharing] GET shared sessions for ${username}: ${result.shared.length}`);
            res.json({ shared: result.shared });
        } catch (error) {
            trackError('shared_list', '/api/sessions/shared');
            res.status(500).json({ error: 'Failed to get shared sessions' });
        }
    });

    /** GET /api/sessions/share/:shareId — access session via share link */
    router.get('/share/:shareId', async (req: Request, res: Response) => {
        const shareId = req.params.shareId;

        try {
            const session = await getSessionManager().getSessionByShareId(shareId);
            if (!session) {
                res.status(404).json({ error: 'Share link not found or expired' });
                return;
            }
            trackShare('access');
            console.log(`[Sharing] GET share/${shareId} → session=${session.id}`);
            res.json({ session });
        } catch (error) {
            trackError('share_access', `/api/sessions/share/${shareId}`);
            res.status(500).json({ error: 'Failed to access shared session' });
        }
    });

    return router;
}
