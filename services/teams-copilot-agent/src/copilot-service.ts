/**
 * Copilot Service — Teams-specific thin proxy to the internal API service.
 *
 * All copilot interaction, session management, and audit are delegated
 * to the internal API service. This module only handles:
 * - Calling the API client
 * - Adapting SSE responses to Teams IStreamer
 * - Backward-compatible module-level API for the bot
 */

import type { IStreamer } from '@microsoft/teams.apps';
import {
    apiChat,
    apiGetSessionStatus,
    apiEndSession,
    apiResumeSession,
    type SessionStatusResult,
} from './api-client.js';
import { pipeSSEToTeams } from './sse-to-teams.js';

// Re-export types for consumers
export type { SessionStatusResult } from './api-client.js';

export interface CopilotResponse {
    success: boolean;
    response?: string;
    error?: string;
    model: string;
    agent: string;
    sessionId?: string;
    sessionExpired?: boolean;
}

export interface UserInfo {
    username: string;
    hostname: string;
}

// ============ Public API (backward-compatible) ============

/**
 * Initialize the Copilot service (no-op — API service handles initialization).
 */
export function initializeCopilotService(): void {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    console.log(`[CopilotService] Configured to use API at: ${apiUrl}`);
}

/**
 * Get the current service configuration from the API.
 */
export function getServiceConfig(): {
    cliUrl: string;
    model: string;
    agentName: string;
    auditEnabled: boolean;
    hasMcpServers: boolean;
} {
    // Return local config since API config is fetched asynchronously
    return {
        cliUrl: process.env.CLI_URL || '(via API)',
        model: process.env.MODEL || 'gpt-5.2',
        agentName: process.env.AGENT_NAME || 'teams-copilot-agent',
        auditEnabled: true,
        hasMcpServers: false,
    };
}

/**
 * Get the status of a conversation's Copilot session.
 */
export async function getConversationSessionStatus(
    conversationId: string,
    username: string
): Promise<SessionStatusResult> {
    return apiGetSessionStatus(conversationId, username);
}

/**
 * End a conversation's Copilot session manually.
 */
export async function endConversationSession(
    conversationId: string,
    username: string
): Promise<boolean> {
    // We need the session ID to end it — get status first
    // The API service handles ending by conversation ID through the session manager
    // For now, use a simplified approach: get sessions, find the one, end it
    try {
        const status = await apiGetSessionStatus(conversationId, username);
        if (!status.exists) return false;
        // The status endpoint doesn't return session ID directly,
        // so we'll end by conversation ID via the resume endpoint pattern
        // Actually, let's just call the API sessions list and find it
        const { apiGetSessions } = await import('./api-client.js');
        const sessions = await apiGetSessions(username);
        const session = (sessions.own as any[]).find(
            s => s.conversation_id === conversationId && s.status === 'active'
        );
        if (!session) return false;
        await apiEndSession(session.id, username);
        return true;
    } catch (error) {
        console.error('[CopilotService] Failed to end session:', error);
        return false;
    }
}

/**
 * Resume the last session for a conversation.
 */
export async function resumeConversationSession(
    conversationId: string,
    userInfo: UserInfo
): Promise<{ resumed: boolean; hadCopilotSession: boolean }> {
    try {
        const result = await apiResumeSession(userInfo.username, conversationId);
        return {
            resumed: result.success,
            hadCopilotSession: !!(result.session as any)?.copilot_session_id,
        };
    } catch (error) {
        console.error('[CopilotService] Failed to resume session:', error);
        return { resumed: false, hadCopilotSession: false };
    }
}

/**
 * Send a message to Copilot via the API service with streaming response.
 *
 * Calls the API's SSE chat endpoint and adapts the stream to Teams IStreamer.
 */
export async function sendMessageStreaming(
    message: string,
    userInfo: UserInfo,
    stream: IStreamer,
    send: (content: string | { type: string }) => Promise<unknown>,
    options?: { conversationId?: string }
): Promise<CopilotResponse> {
    const conversationId = options?.conversationId;

    try {
        const response = await apiChat(message, userInfo, conversationId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[CopilotService] API returned ${response.status}: ${errorText}`);
            return {
                success: false,
                error: `API error: ${response.status}`,
                model: 'unknown',
                agent: 'unknown',
            };
        }

        const result = await pipeSSEToTeams(response, stream, send);

        if (!result.success) {
            // Check if it's a session expiration error
            if (result.error?.includes('expired')) {
                return {
                    success: false,
                    error: result.error,
                    model: 'unknown',
                    agent: 'unknown',
                    sessionExpired: true,
                };
            }
            return {
                success: false,
                error: result.error || 'Unknown error',
                model: 'unknown',
                agent: 'unknown',
            };
        }

        return {
            success: true,
            model: 'unknown', // API doesn't return model in SSE currently
            agent: 'unknown',
        };

    } catch (error) {
        console.error('[CopilotService] sendMessageStreaming error:', (error as Error).message);
        return {
            success: false,
            error: (error as Error).message,
            model: 'unknown',
            agent: 'unknown',
        };
    }
}

/**
 * Get Kusto queries for a session — not supported via thin proxy.
 * This feature requires direct Cosmos access which is now in the API service.
 * TODO: Add /api/sessions/:id/tool-executions endpoint to API service.
 */
export async function getKustoQueriesForSession(
    _conversationId: string,
    _username: string,
    _page: number = 1
): Promise<null> {
    console.log('[CopilotService] getKustoQueriesForSession not yet supported via API proxy');
    return null;
}
