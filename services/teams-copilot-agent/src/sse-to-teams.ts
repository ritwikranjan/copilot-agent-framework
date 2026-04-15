/**
 * SSE-to-Teams Adapter — reads SSE events from the API response stream
 * and adapts them to Teams IStreamer + send().
 *
 * Reuses the existing throttling/retry patterns from the previous
 * teamsStreamerToHandler() implementation.
 */

import type { IStreamer } from '@microsoft/teams.apps';
import type { SSEEvent } from './api-client.js';
import { trackThrottle } from './telemetry.js';

/**
 * Parse a raw SSE response body and pipe events to the Teams stream.
 *
 * @param response - The fetch Response from apiChat() (SSE stream)
 * @param stream - Teams IStreamer for the current message
 * @param send - Teams send function for complete messages
 * @returns Summary of what happened (success, error, etc.)
 */
export async function pipeSSEToTeams(
    response: Response,
    stream: IStreamer,
    send: (content: string | { type: string }) => Promise<unknown>
): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    let eventCount = 0;
    let streamDead = false;
    const toolsUsed: string[] = [];

    // --- Throttled stream.update (same logic as old teamsStreamerToHandler) ---
    let lastFlushTime = 0;
    const MIN_FLUSH_INTERVAL_MS = 3000;
    let pendingUpdate: string | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const doFlush = (message: string) => {
        if (streamDead) return;
        try {
            stream.update(message);
            lastFlushTime = Date.now();
        } catch {
            streamDead = true;
        }
    };

    const queueUpdate = (message: string) => {
        if (streamDead) return;
        pendingUpdate = message;
        const elapsed = Date.now() - lastFlushTime;
        if (elapsed >= MIN_FLUSH_INTERVAL_MS) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
            pendingUpdate = null;
            doFlush(message);
        } else if (!flushTimer) {
            const delay = MIN_FLUSH_INTERVAL_MS - elapsed;
            flushTimer = setTimeout(() => {
                flushTimer = undefined;
                if (pendingUpdate) {
                    const msg = pendingUpdate;
                    pendingUpdate = null;
                    doFlush(msg);
                }
            }, delay);
        }
    };

    // --- Retry send with backoff ---
    const sendWithRetry = async (content: string, maxRetries = 3): Promise<void> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await send(content);
                return;
            } catch (err: any) {
                const status = err?.response?.status || err?.status;
                const retryAfter = err?.response?.headers?.['retry-after'];
                if ((status === 429 || status === 403) && attempt < maxRetries) {
                    trackThrottle(status, 'sendMessage');
                    const waitMs = (retryAfter ? parseInt(retryAfter, 10) : 2) * 1000 + (attempt * 1000);
                    console.log(`[SSE-Teams] HTTP ${status}, retrying in ${waitMs}ms`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    throw err;
                }
            }
        }
    };

    // --- Throttled typing indicator ---
    let lastTypingTime = 0;
    const TYPING_THROTTLE_MS = 5000;
    const sendTyping = () => {
        const now = Date.now();
        if (now - lastTypingTime >= TYPING_THROTTLE_MS) {
            lastTypingTime = now;
            send({ type: 'typing' }).catch(() => {});
        }
    };

    // --- Parse SSE stream ---
    try {
        if (!response.body) {
            return { success: false, error: 'No response body' };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastError: string | undefined;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse complete SSE events from buffer
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || ''; // Keep incomplete event in buffer

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;

                let event: SSEEvent;
                try {
                    event = JSON.parse(line.slice(6));
                } catch {
                    continue;
                }

                eventCount++;

                switch (event.type) {
                    case 'delta':
                        // Deltas are buffered by the API — we don't emit individually in Teams
                        break;

                    case 'status':
                        if (event.content) {
                            const toolMatch = event.content.match(/🔧 Using tool: (.+)/);
                            if (toolMatch) toolsUsed.push(toolMatch[1]);
                            queueUpdate(event.content);
                        }
                        break;

                    case 'message':
                        if (event.content) {
                            try {
                                await sendWithRetry(event.content);
                            } catch (err) {
                                console.error('[SSE-Teams] Failed to send message:', err);
                            }
                        }
                        break;

                    case 'typing':
                        sendTyping();
                        break;

                    case 'error':
                        lastError = event.content;
                        break;

                    case 'done':
                        // Clean up flush timer
                        if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }

                        // Close stream with summary
                        if (!streamDead) {
                            try {
                                const unique = [...new Set(toolsUsed)];
                                const summary = unique.length > 0
                                    ? `✅ Analysis complete (used: ${unique.join(', ')})`
                                    : '✅ Response complete';
                                stream.emit(summary);
                            } catch { /* stream already dead */ }
                        }
                        break;
                }
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[SSE-Teams] Stream closed (duration=${duration}ms, events=${eventCount})`);

        if (lastError) {
            return { success: false, error: lastError };
        }
        return { success: true };

    } catch (error) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
        console.error('[SSE-Teams] Stream error:', (error as Error).message);
        return { success: false, error: (error as Error).message };
    }
}
