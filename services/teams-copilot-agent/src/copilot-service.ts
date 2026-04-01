/**
 * Copilot Service - Teams-specific wrapper around @ritwikranjan/copilot-agent-framework.
 *
 * Delegates to the library's CopilotService class while providing:
 * - Teams IStreamer -> IStreamHandler adaptation
 * - Singleton lifecycle management
 * - Environment-driven configuration
 * - Backward-compatible module-level API
 */

import {
    CopilotService,
    loadSystemPrompt,
    loadToolsConfig,
    buildMcpServersConfig,
} from '@ritwikranjan/copilot-agent-framework';
import type {
    IStreamHandler,
    CopilotResponse,
    SessionStatusResult,
    UserInfo,
    SessionInfo,
} from '@ritwikranjan/copilot-agent-framework';
import type { IStreamer } from '@microsoft/teams.apps';
import { getSessionManager, getAuditManager } from './cosmos_integration/index.js';

// Re-export types for consumers
export type { CopilotResponse, SessionStatusResult } from '@ritwikranjan/copilot-agent-framework';

// Configuration
const CLI_URL = process.env.CLI_URL || 'localhost:3000';
const MODEL = process.env.MODEL || 'gpt-5.2';
const AGENT_NAME = process.env.AGENT_NAME || 'teams-copilot-agent';
const ENABLE_AUDIT = process.env.ENABLE_AUDIT !== 'false';

// ============ IStreamer -> IStreamHandler Adapter ============

function teamsStreamerToHandler(stream: IStreamer, send: (content: string | { type: string }) => Promise<unknown>): IStreamHandler {
    // Retry send with backoff for Bot Framework 429 rate limits
    const sendWithRetry = async (content: string, maxRetries = 3): Promise<void> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await send(content);
                console.log(`[sendMessage] Sent successfully (${content.length} chars, attempt ${attempt + 1})`);
                return;
            } catch (err: any) {
                const status = err?.response?.status || err?.status;
                const retryAfter = err?.response?.headers?.['retry-after'];
                if (status === 429 && attempt < maxRetries) {
                    const waitMs = (retryAfter ? parseInt(retryAfter, 10) : 2) * 1000 + (attempt * 1000);
                    console.log(`[sendMessage] Rate limited (429), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`[sendMessage] Failed after ${attempt + 1} attempts:`, err?.message || err);
                    throw err;
                }
            }
        }
    };

    // Throttle typing indicators to avoid contributing to 429 rate limits
    let lastTypingTime = 0;
    const TYPING_THROTTLE_MS = 5000; // max one typing indicator every 5s

    return {
        emit: (content: string) => stream.emit(content),
        update: (status: string) => stream.update(status),
        sendMessage: async (content: string) => { await sendWithRetry(content); },
        typing: () => {
            const now = Date.now();
            if (now - lastTypingTime >= TYPING_THROTTLE_MS) {
                lastTypingTime = now;
                send({ type: 'typing' }).catch(() => {});
            }
        },
        close: () => { stream.emit(''); }
    };
}

// ============ Singleton CopilotService ============

let _service: CopilotService | null = null;

function getService(): CopilotService {
    if (!_service) {
        const systemPrompt = loadSystemPrompt();
        const toolsConfig = loadToolsConfig();
        const mcpServers = buildMcpServersConfig(toolsConfig);

        const sessionManager = getSessionManager();
        const auditManager = ENABLE_AUDIT ? getAuditManager() : undefined;

        _service = new CopilotService(
            {
                cliUrl: CLI_URL,
                model: MODEL,
                agentName: AGENT_NAME,
                systemPrompt,
                mcpServers,
                enableAudit: ENABLE_AUDIT,
            },
            sessionManager,
            auditManager,
        );
    }
    return _service;
}

// ============ Public API (backward-compatible) ============

/**
 * Initialize the Copilot service (load configurations).
 */
export function initializeCopilotService(): void {
    getService();
}

/**
 * Get the current service configuration.
 */
export function getServiceConfig(): {
    cliUrl: string;
    model: string;
    agentName: string;
    auditEnabled: boolean;
    hasMcpServers: boolean;
} {
    return getService().getConfig();
}

/**
 * Get the status of a conversation's Copilot session.
 */
export async function getConversationSessionStatus(
    conversationId: string,
    username: string
): Promise<SessionStatusResult> {
    return getService().getConversationSessionStatus(conversationId, username);
}

/**
 * End a conversation's Copilot session manually.
 */
export async function endConversationSession(
    conversationId: string,
    username: string
): Promise<boolean> {
    return getService().endConversationSession(conversationId, username);
}

/**
 * Resume an expired session by creating a new one.
 */
export async function resumeConversationSession(
    conversationId: string,
    userInfo: UserInfo
): Promise<SessionInfo | null> {
    return getService().resumeConversationSession(conversationId, userInfo);
}

/**
 * Send a message to Copilot and get a synchronous response.
 */
export async function sendMessage(
    message: string,
    userInfo: UserInfo,
    options?: {
        sessionId?: string;
        sessionName?: string;
    }
): Promise<CopilotResponse> {
    return getService().sendMessage(message, userInfo, options);
}

/**
 * Send a message to Copilot with streaming response via Teams IStreamer.
 */
export async function sendMessageStreaming(
    message: string,
    userInfo: UserInfo,
    stream: IStreamer,
    send: (content: string | { type: string }) => Promise<unknown>,
    options?: {
        conversationId: string;
        sessionId?: string;
        sessionName?: string;
        showReasoning?: boolean;
    }
): Promise<CopilotResponse> {
    return getService().sendMessageStreaming(
        message,
        userInfo,
        teamsStreamerToHandler(stream, send),
        options
    );
}