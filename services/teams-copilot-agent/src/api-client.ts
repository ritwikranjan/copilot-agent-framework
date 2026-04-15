/**
 * API Client — HTTP client for the internal Copilot API service.
 *
 * Used by the Teams bot to delegate all copilot interaction, session,
 * and audit operations to the centralized API service.
 */

function getApiUrl(): string {
    return process.env.API_URL || 'http://localhost:4000';
}

export interface SSEEvent {
    type: 'delta' | 'status' | 'message' | 'typing' | 'done' | 'error';
    content?: string;
}

export interface SessionStatusResult {
    exists: boolean;
    expired: boolean;
    remainingTimeMs?: number;
    createdAt?: string;
    lastActivityAt?: string;
    copilotSessionId?: string;
}

/**
 * Send a chat message via the API and return a ReadableStream of SSE events.
 */
export async function apiChat(
    message: string,
    userInfo: { username: string; hostname: string },
    conversationId?: string
): Promise<Response> {
    const startTime = Date.now();
    console.log(`[API Client] POST ${getApiUrl()}/api/chat user=${userInfo.username}`);

    const response = await fetch(`${getApiUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, userInfo, conversationId }),
    });

    console.log(`[API Client] POST /api/chat status=${response.status} (${Date.now() - startTime}ms)`);
    return response;
}

/**
 * Get session status for a conversation.
 */
export async function apiGetSessionStatus(
    conversationId: string,
    username: string
): Promise<SessionStatusResult> {
    const url = `${getApiUrl()}/api/sessions/status?username=${encodeURIComponent(username)}&conversationId=${encodeURIComponent(conversationId)}`;
    console.log(`[API Client] GET ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<SessionStatusResult>;
}

/**
 * End a session.
 */
export async function apiEndSession(
    sessionId: string,
    username: string
): Promise<{ success: boolean }> {
    console.log(`[API Client] POST ${getApiUrl()}/api/sessions/${sessionId}/end`);
    const response = await fetch(`${getApiUrl()}/api/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
    });
    return response.json() as Promise<{ success: boolean }>;
}

/**
 * Resume (reactivate) a session by conversation ID.
 */
export async function apiResumeSession(
    username: string,
    conversationId: string
): Promise<{ success: boolean; session?: unknown }> {
    console.log(`[API Client] POST ${getApiUrl()}/api/sessions/resume`);
    const response = await fetch(`${getApiUrl()}/api/sessions/_/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, conversationId }),
    });
    return response.json() as Promise<{ success: boolean; session?: unknown }>;
}

/**
 * Get user sessions list.
 */
export async function apiGetSessions(username: string): Promise<{ own: unknown[]; shared: unknown[] }> {
    const url = `${getApiUrl()}/api/sessions?username=${encodeURIComponent(username)}`;
    console.log(`[API Client] GET ${url}`);
    const response = await fetch(url);
    return response.json() as Promise<{ own: unknown[]; shared: unknown[] }>;
}

/**
 * Get Kusto queries for a session (reads tool executions from API).
 */
export async function apiGetSessionHistory(
    sessionId: string,
    username: string
): Promise<{ interactions: unknown[] }> {
    const url = `${getApiUrl()}/api/sessions/${sessionId}/history?username=${encodeURIComponent(username)}`;
    console.log(`[API Client] GET ${url}`);
    const response = await fetch(url);
    return response.json() as Promise<{ interactions: unknown[] }>;
}
