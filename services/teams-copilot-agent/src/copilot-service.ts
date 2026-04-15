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
} from '@ritwikranjan/copilot-agent-framework';
import type { IStreamer } from '@microsoft/teams.apps';
import { getSessionManager, getAuditManager, getAuditCosmosStore, getSessionCosmosStore } from './cosmos_integration/index.js';
import type { ToolExecution } from './cosmos_integration/index.js';

// Re-export types for consumers
export type { CopilotResponse, SessionStatusResult } from '@ritwikranjan/copilot-agent-framework';

// Configuration
const CLI_URL = process.env.CLI_URL || 'localhost:3000';
const MODEL = process.env.MODEL || 'gpt-5.2';
const AGENT_NAME = process.env.AGENT_NAME || 'teams-copilot-agent';
const ENABLE_AUDIT = process.env.ENABLE_AUDIT !== 'false';

import { trackThrottle } from './telemetry.js';

// ============ IStreamer -> IStreamHandler Adapter ============

function teamsStreamerToHandler(stream: IStreamer, send: (content: string | { type: string }) => Promise<unknown>): IStreamHandler {
    // Retry send with backoff for Bot Framework rate limits
    const sendWithRetry = async (content: string, maxRetries = 3): Promise<void> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await send(content);
                console.log(`[sendMessage] Sent successfully (${content.length} chars, attempt ${attempt + 1})`);
                return;
            } catch (err: any) {
                const status = err?.response?.status || err?.status;
                const retryAfter = err?.response?.headers?.['retry-after'];
                if ((status === 429 || status === 403) && attempt < maxRetries) {
                    trackThrottle(status, 'sendMessage');
                    const waitMs = (retryAfter ? parseInt(retryAfter, 10) : 2) * 1000 + (attempt * 1000);
                    console.log(`[sendMessage] HTTP ${status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`[sendMessage] Failed after ${attempt + 1} attempts (HTTP ${status}):`, err?.message || err);
                    throw err;
                }
            }
        }
    };

    // Throttle typing indicators
    let lastTypingTime = 0;
    const TYPING_THROTTLE_MS = 5000;

    // --- Throttled message queue for stream updates ---
    // Bot Framework limits informative stream chunks; exceeding ~15 causes 403.
    // Queue updates and flush at most one every 3s, keeping only the latest.
    let streamDead = false;
    const toolsUsed: string[] = [];
    let lastFlushTime = 0;
    const MIN_FLUSH_INTERVAL_MS = 3000;
    let pendingUpdate: string | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const doFlush = (message: string) => {
        if (streamDead) return;
        try {
            stream.update(message);
            lastFlushTime = Date.now();
        } catch (err: any) {
            console.warn('[stream.update] Error (suppressed):', err?.message || err);
            streamDead = true;
        }
    };

    const queueUpdate = (message: string) => {
        if (streamDead) return;
        pendingUpdate = message; // always keep only the latest

        const elapsed = Date.now() - lastFlushTime;
        if (elapsed >= MIN_FLUSH_INTERVAL_MS) {
            // Enough time has passed — flush immediately
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
            pendingUpdate = null;
            doFlush(message);
        } else if (!flushTimer) {
            // Schedule a flush for when the interval elapses
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
        // If timer already scheduled, pendingUpdate will be picked up when it fires
    };

    return {
        emit: (content: string) => {
            if (streamDead) return;
            try { stream.emit(content); } catch { streamDead = true; }
        },
        update: (status: string) => {
            // Track tool names for the final closing summary
            const toolMatch = status.match(/🔧 Using tool: (.+)/);
            if (toolMatch) toolsUsed.push(toolMatch[1]);
            queueUpdate(status);
        },
        sendMessage: async (content: string) => { await sendWithRetry(content); },
        typing: () => {
            const now = Date.now();
            if (now - lastTypingTime >= TYPING_THROTTLE_MS) {
                lastTypingTime = now;
                send({ type: 'typing' }).catch(() => {});
            }
        },
        close: () => {
            // Cancel any pending flush timer
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }

            if (!streamDead) {
                // Emit a final informative message so the stream card
                // doesn't look like an error when it closes
                try {
                    const unique = [...new Set(toolsUsed)];
                    const summary = unique.length > 0
                        ? `✅ Analysis complete (used: ${unique.join(', ')})`
                        : '✅ Response complete';
                    stream.emit(summary);
                } catch { /* stream already dead */ }
            }
        }
    };
}

// ============ Kusto Query Retrieval ============

interface KustoQueryPage {
    queries: { index: number; timestamp: string; query: string; database: string; cluster: string }[];
    page: number;
    totalPages: number;
    totalQueries: number;
}

const QUERIES_PER_PAGE = 3;

/**
 * Get paginated Kusto queries from tool executions for a session.
 * Reads directly from Cosmos DB (no AI call).
 */
export async function getKustoQueriesForSession(
    conversationId: string,
    username: string,
    page: number = 1
): Promise<KustoQueryPage | null> {
    // Look up the most recent session for this conversation (any status)
    const sessionStore = getSessionCosmosStore();
    await sessionStore.initialize();
    const session = await sessionStore.getLastSessionByConversationId(username, conversationId);
    if (!session) {
        return null;
    }

    const auditStore = getAuditCosmosStore();
    await auditStore.initialize();
    const allTools: ToolExecution[] = await auditStore.getToolExecutionsBySession(session.id);

    // Filter to kusto tool calls and extract queries
    const kustoQueries = allTools
        .filter(t => t.tool_name === 'azure-kusto' && t.arguments)
        .map((t, i) => {
            const args = t.arguments as Record<string, unknown>;
            const params = (args.parameters || args) as Record<string, unknown>;
            return {
                index: i + 1,
                timestamp: t.start_time,
                query: (params.query as string) || '(no query)',
                database: (params.database as string) || 'unknown',
                cluster: (params['cluster-uri'] as string) || 'unknown',
            };
        });

    if (kustoQueries.length === 0) {
        return { queries: [], page: 1, totalPages: 0, totalQueries: 0 };
    }

    const totalPages = Math.ceil(kustoQueries.length / QUERIES_PER_PAGE);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * QUERIES_PER_PAGE;
    const pageQueries = kustoQueries.slice(start, start + QUERIES_PER_PAGE);

    return {
        queries: pageQueries,
        page: safePage,
        totalPages,
        totalQueries: kustoQueries.length,
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
 * Resume the last session for a conversation by reactivating it in-place.
 * Both the Teams session record and the Copilot CLI session remain the same —
 * only the expiry is extended by 12 hours.
 */
export async function resumeConversationSession(
    conversationId: string,
    userInfo: UserInfo
): Promise<{ resumed: boolean; hadCopilotSession: boolean }> {
    const sessionStore = getSessionCosmosStore();
    await sessionStore.initialize();

    // Find the most recent session for this conversation (any status)
    const lastSession = await sessionStore.getLastSessionByConversationId(userInfo.username, conversationId);
    if (!lastSession) {
        return { resumed: false, hadCopilotSession: false };
    }

    // Reactivate: set back to active, extend expiry by 12h, update activity timestamp
    const now = new Date();
    lastSession.status = 'active' as any;
    lastSession.expires_at = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
    lastSession.last_activity_at = now.toISOString();
    lastSession.end_time = undefined;

    await sessionStore.updateSession(
        lastSession.id,
        lastSession.user_info.username,
        lastSession
    );

    console.log(`[resume] Reactivated session ${lastSession.id}, copilot_session_id=${lastSession.copilot_session_id || 'none'}`);

    return { resumed: true, hadCopilotSession: !!lastSession.copilot_session_id };
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