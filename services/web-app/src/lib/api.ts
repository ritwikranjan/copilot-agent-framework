/**
 * Browser API client — calls the Next.js server routes (which proxy to the internal API).
 *
 * All requests include the Entra ID Bearer token for authentication.
 */

export interface SSEEvent {
    type: 'delta' | 'status' | 'message' | 'typing' | 'done' | 'error';
    content?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface SessionInfo {
    id: string;
    name?: string;
    conversation_id?: string;
    status: string;
    start_time: string;
    last_activity_at?: string;
    is_shared?: boolean;
}

/**
 * Send a chat message and receive SSE events via callback.
 *
 * @param message The user's message
 * @param conversationId Optional conversation ID to continue
 * @param token Bearer token for auth
 * @param onEvent Callback for each SSE event
 * @returns AbortController to cancel the stream
 */
export function sendMessage(
    message: string,
    conversationId: string | undefined,
    token: string,
    onEvent: (event: SSEEvent) => void
): AbortController {
    const controller = new AbortController();
    const startTime = performance.now();
    let firstToken = false;

    console.log('[Chat] SSE connecting...');

    fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message, conversationId }),
        signal: controller.signal,
    }).then(async (response) => {
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            onEvent({ type: 'error', content: error.error || `HTTP ${response.status}` });
            onEvent({ type: 'done' });
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            onEvent({ type: 'error', content: 'No response body' });
            onEvent({ type: 'done' });
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let eventCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const event: SSEEvent = JSON.parse(line.slice(6));
                    eventCount++;

                    if (!firstToken && (event.type === 'delta' || event.type === 'message')) {
                        firstToken = true;
                        const ttft = performance.now() - startTime;
                        console.log(`[Chat] First token (${Math.round(ttft)}ms)`);
                    }

                    onEvent(event);

                    if (event.type === 'done') {
                        const total = performance.now() - startTime;
                        console.log(`[Chat] Stream complete (${Math.round(total)}ms, ${eventCount} events)`);
                    }
                } catch {
                    // Skip malformed events
                }
            }
        }
    }).catch((err) => {
        if (err.name !== 'AbortError') {
            console.error('[Chat] SSE error:', err);
            onEvent({ type: 'error', content: err.message });
            onEvent({ type: 'done' });
        }
    });

    return controller;
}

/**
 * Get user's sessions (own + shared).
 */
export async function getSessions(token: string): Promise<{ own: SessionInfo[]; shared: Array<{ share: unknown; session: SessionInfo }> }> {
    const res = await fetch('/api/sessions', {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to get sessions: ${res.status}`);
    return res.json();
}

/**
 * Get conversation history for a session.
 */
export async function getSessionHistory(sessionId: string, token: string): Promise<{ interactions: unknown[] }> {
    const res = await fetch(`/api/sessions/${sessionId}/history`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to get history: ${res.status}`);
    return res.json();
}

/**
 * Share a session with another user.
 */
export async function shareSession(
    sessionId: string,
    sharedWith: string,
    role: 'viewer' | 'collaborator',
    token: string
): Promise<{ success: boolean; share: unknown }> {
    const res = await fetch(`/api/sessions/${sessionId}/share`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sharedWith, role }),
    });
    if (!res.ok) throw new Error(`Failed to share session: ${res.status}`);
    return res.json();
}
