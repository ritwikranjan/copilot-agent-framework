/**
 * SSE Stream Handler — implements IStreamHandler for Server-Sent Events.
 *
 * Writes events in SSE format: `data: {...}\n\n`
 * Each event is a JSON object with a `type` field.
 */

import type { Response } from 'express';
import type { IStreamHandler } from '@ritwikranjan/copilot-agent-framework';

export interface SSEEvent {
    type: 'delta' | 'status' | 'message' | 'typing' | 'done' | 'error';
    content?: string;
}

/**
 * Create an IStreamHandler that writes Server-Sent Events to an Express response.
 */
export function createSSEStreamHandler(res: Response): IStreamHandler {
    const write = (event: SSEEvent): void => {
        try {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
            // Response may be closed already
        }
    };

    return {
        emit(content: string): void {
            write({ type: 'delta', content });
        },
        update(status: string): void {
            write({ type: 'status', content: status });
        },
        async sendMessage(content: string): Promise<void> {
            write({ type: 'message', content });
        },
        typing(): void {
            write({ type: 'typing' });
        },
        close(): void {
            write({ type: 'done' });
            try {
                res.end();
            } catch {
                // Already closed
            }
        },
    };
}

/**
 * Set up an Express response for SSE streaming.
 */
export function initSSEResponse(res: Response): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
}
