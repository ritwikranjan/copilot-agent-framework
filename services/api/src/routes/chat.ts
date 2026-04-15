/**
 * Chat route — POST /api/chat
 *
 * Accepts { message, userInfo, conversationId?, sessionId? }
 * Returns SSE stream of chat events.
 */

import { Router, type Request, type Response } from 'express';
import type { CopilotService } from '@ritwikranjan/copilot-agent-framework';
import type { UserInfo } from '@ritwikranjan/copilot-agent-framework';
import { defaultStreamingHandler } from '@ritwikranjan/copilot-agent-framework';
import { createSSEStreamHandler, initSSEResponse } from '../sse-stream-handler.js';
import { trackChat, trackChatLatency, trackError } from '../telemetry.js';

export function createChatRouter(getService: () => CopilotService): Router {
    const router = Router();

    router.post('/', async (req: Request, res: Response) => {
        const startTime = Date.now();
        const { message, userInfo, conversationId, sessionId } = req.body as {
            message?: string;
            userInfo?: UserInfo;
            conversationId?: string;
            sessionId?: string;
        };

        if (!message || typeof message !== 'string') {
            res.status(400).json({ error: 'Missing required field: message' });
            return;
        }
        if (!userInfo || !userInfo.username) {
            res.status(400).json({ error: 'Missing required field: userInfo.username' });
            return;
        }

        console.log(`[Chat] POST /api/chat user=${userInfo.username} convId=${conversationId || '(new)'}`);

        try {
            initSSEResponse(res);
            const streamHandler = createSSEStreamHandler(res);

            const response = await getService().processMessage({
                message,
                userInfo,
                handleEvent: defaultStreamingHandler(streamHandler),
                conversationId,
                sessionId,
            });

            trackChat(response.success);
            trackChatLatency(startTime, response.success);

            if (!response.success && !res.writableEnded) {
                // Send error as SSE event before closing
                res.write(`data: ${JSON.stringify({ type: 'error', content: response.error })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                res.end();
            }
        } catch (error) {
            trackChat(false);
            trackChatLatency(startTime, false);
            trackError('chat_error', '/api/chat');
            console.error('[Chat] Error:', (error as Error).message);

            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            } else if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: (error as Error).message })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                res.end();
            }
        }
    });

    return router;
}
