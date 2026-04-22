/**
 * Copilot Service - Framework-agnostic integration with GitHub Copilot SDK.
 *
 * Provides a high-level class-based interface for interacting with Copilot,
 * with support for streaming, MCP tools, audit logging, and persistent sessions.
 *
 * SESSION MANAGEMENT:
 * This service uses a STATELESS architecture where all session state is persisted
 * via the injected SessionManager. This enables horizontal scaling with multiple
 * container instances.
 *
 * - Sessions are identified by conversationId
 * - Copilot SDK session IDs are stored for resume capability
 * - Sessions expire after 12 hours
 */

import { CopilotClient } from '@github/copilot-sdk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
    UserInfo,
    SessionInfo,
    CopilotResponse,
    MCPServerConfig,
    ToolsConfig,
    IStreamHandler,
    ProcessMessageContext,
    ProcessMessageOptions,
    HandleEventFn,
    AuditContext,
} from './models.js';
import { SessionManager, SessionNotFoundError, SessionExpiredError, formatRemainingTime } from './session-manager.js';
import type { SessionStatusResult } from './session-manager.js';
import type { AuditManager } from './audit-manager.js';
import type { ILogger } from './logger.js';
import { getLogger } from './logger.js';

// ============ Config Types ============

export interface CopilotServiceConfig {
    /** URL of the CLI server (e.g., 'localhost:3000') */
    cliUrl: string;
    /** Model to use (e.g., 'gpt-5.2') */
    model: string;
    /** Agent name identifier */
    agentName: string;
    /** System prompt content (if not provided, a default is used) */
    systemPrompt?: string;
    /** MCP server configurations (keyed by server name) */
    mcpServers?: Record<string, MCPServerConfig>;
    /** Whether audit logging is enabled */
    enableAudit?: boolean;
    /** Optional custom logger (defaults to debug-based logger) */
    logger?: ILogger;
}

export interface SendMessageOptions {
    /** Explicit session ID to resume */
    sessionId?: string;
    /** Session name */
    sessionName?: string;
    /** Conversation ID for session persistence */
    conversationId?: string;
    /** Whether to show reasoning in stream updates */
    showReasoning?: boolean;
}

// ============ Standalone Utility Functions ============

/**
 * Load system prompt from environment variable or file paths.
 *
 * Resolution order:
 * 1. Environment variable (options.envVar or SYSTEM_PROMPT)
 * 2. SYSTEM_PROMPT_PATH environment variable
 * 3. Provided file paths (options.filePaths)
 * 4. Default paths: /app/system-prompt.md, ./system-prompt.md
 * 5. Minimal fallback
 */
export function loadSystemPrompt(options?: { envVar?: string; filePaths?: string[] }): string {
    const log = getLogger('config');
    // 1. Check for inline system prompt from environment
    const envVar = options?.envVar || 'SYSTEM_PROMPT';
    if (process.env[envVar]) {
        log.info('Using system prompt from %s environment variable', envVar);
        return process.env[envVar]!;
    }

    // 2. Check for custom system prompt path
    const customPath = process.env.SYSTEM_PROMPT_PATH;
    if (customPath && existsSync(customPath)) {
        log.info('Loaded system prompt from: %s', customPath);
        return readFileSync(customPath, 'utf-8');
    }

    // 3. Try provided file paths
    const filePaths = options?.filePaths || [
        '/app/system-prompt.md',
        join(process.cwd(), 'system-prompt.md')
    ];

    for (const filePath of filePaths) {
        if (existsSync(filePath)) {
            log.info('Loaded system prompt from: %s', filePath);
            return readFileSync(filePath, 'utf-8');
        }
    }

    // 4. Use minimal default
    log.warn('No system prompt found, using minimal default');
    return 'You are a helpful AI assistant.';
}

/**
 * Load MCP tools configuration from a JSON file.
 *
 * Resolution order:
 * 1. options.configPath
 * 2. TOOLS_CONFIG_PATH environment variable
 * 3. options.fallbackPaths or default paths
 */
export function loadToolsConfig(options?: { configPath?: string; fallbackPaths?: string[] }): ToolsConfig | null {
    const log = getLogger('config');
    const configPath = options?.configPath || process.env.TOOLS_CONFIG_PATH || '/app/tools-config.json';

    if (existsSync(configPath)) {
        try {
            const config = JSON.parse(readFileSync(configPath, 'utf-8')) as ToolsConfig;
            log.info('Loaded tools config from: %s', configPath);
            return config;
        } catch (error) {
            log.warn('Failed to parse tools config: %s', (error as Error).message);
        }
    }

    // Try fallback paths
    const fallbackPaths = options?.fallbackPaths || [
        join(process.cwd(), 'tools-config.json')
    ];

    for (const fallbackPath of fallbackPaths) {
        if (existsSync(fallbackPath)) {
            try {
                const config = JSON.parse(readFileSync(fallbackPath, 'utf-8')) as ToolsConfig;
                log.info('Loaded tools config from: %s', fallbackPath);
                return config;
            } catch (error) {
                log.warn('Failed to parse tools config: %s', (error as Error).message);
            }
        }
    }

    return null;
}

/**
 * Build MCP servers config from tools configuration.
 * Converts from Record format in tools-config.json to array format expected by SDK.
 * Injects extra environment variables (e.g., managed identity env vars).
 */
export function buildMcpServersConfig(
    toolsConfig: ToolsConfig | null,
    extraEnv?: Record<string, string>
): Record<string, MCPServerConfig> | undefined {
    if (!toolsConfig || !toolsConfig.mcp_servers) {
        return undefined;
    }

    const mcpServers: Record<string, MCPServerConfig> = {};

    // Merge extra env vars (e.g., managed identity from Container Apps runtime)
    const envOverrides: Record<string, string> = { ...(extraEnv || {}) };
    if (process.env.IDENTITY_ENDPOINT) {
        envOverrides.IDENTITY_ENDPOINT = process.env.IDENTITY_ENDPOINT;
    }
    if (process.env.IDENTITY_HEADER) {
        envOverrides.IDENTITY_HEADER = process.env.IDENTITY_HEADER;
    }
    if (process.env.AZURE_TENANT_ID) {
        envOverrides.AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
    }
    if (process.env.AZURE_SUBSCRIPTION_ID) {
        envOverrides.AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;
    }
    if (process.env.AZURE_TOKEN_CREDENTIALS) {
        envOverrides.AZURE_TOKEN_CREDENTIALS = process.env.AZURE_TOKEN_CREDENTIALS;
    }

    for (const [serverName, serverConfig] of Object.entries(toolsConfig.mcp_servers)) {
        const mergedEnv = { ...envOverrides, ...(serverConfig.env || {}) };

        mcpServers[serverName] = {
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: mergedEnv,
            tools: serverConfig.tools || ['*']
        };
    }

    return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

// ============ Default Streaming Handler ============

/**
 * Create a HandleEventFn that implements the standard streaming event loop.
 *
 * This is the default handler used by `sendMessageStreaming()`. It subscribes
 * to copilot session events, buffers content by turn, sends messages via the
 * stream handler, and manages audit logging for tool executions.
 *
 * Use this when you want the standard streaming behavior but with the
 * `processMessage()` API for custom session/audit integration.
 *
 * @param streamHandler - The stream handler to send events to (SSE, Teams, etc.)
 * @param options - Optional configuration
 * @returns A HandleEventFn that can be passed to `processMessage()`
 */
export function defaultStreamingHandler(
    streamHandler: IStreamHandler,
    options?: { showReasoning?: boolean }
): HandleEventFn {
    return async (ctx: ProcessMessageContext): Promise<CopilotResponse> => {
        const { copilotSession, audit, logger, message, config } = ctx;
        const pendingTools: Map<string, { auditToolId: string; toolName: string }> = new Map();
        let responseContent = '';
        let reasoningContent = '';
        let hasContentInCurrentTurn = false;
        let turnCount = 0;
        let turnContentBuffer = '';
        let unsubscribe: (() => void) | undefined;

        // Start audit interaction
        if (audit) {
            await audit.startInteraction(message);
        }

        const STREAM_TIMEOUT = 600000; // 10 minutes
        const FIRST_RESPONSE_TIMEOUT = 120000; // 120s
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let firstResponseTimeoutId: ReturnType<typeof setTimeout> | undefined;
        let receivedFirstEvent = false;
        const pendingMessages: Promise<void>[] = [];

        try {
            await new Promise<void>((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    logger.error('Streaming timed out after %d ms', STREAM_TIMEOUT);
                    reject(new Error('Streaming timed out'));
                }, STREAM_TIMEOUT);

                firstResponseTimeoutId = setTimeout(() => {
                    if (!receivedFirstEvent) {
                        logger.error('No response from model within %d ms', FIRST_RESPONSE_TIMEOUT);
                        if (timeoutId) clearTimeout(timeoutId);
                        reject(new Error('Session context too large or model unresponsive. Try /new to start a fresh session.'));
                    }
                }, FIRST_RESPONSE_TIMEOUT);

                unsubscribe = copilotSession.on((event: { type: string; data?: Record<string, unknown> }) => {
                    try {
                        if (!receivedFirstEvent) {
                            const activeEvents = ['assistant.turn_start', 'assistant.reasoning_delta', 'assistant.message_delta', 'assistant.streaming_delta', 'assistant.reasoning', 'tool.execution_start', 'session.tools_updated'];
                            if (activeEvents.includes(event.type)) {
                                receivedFirstEvent = true;
                                if (firstResponseTimeoutId) { clearTimeout(firstResponseTimeoutId); firstResponseTimeoutId = undefined; }
                            }
                        }

                        logger.debug('Event: %s, data: %O', event.type, event.data);

                        switch (event.type) {
                            case 'assistant.turn_start':
                                logger.debug('Turn start (turn %d)', turnCount);
                                hasContentInCurrentTurn = false;
                                turnContentBuffer = '';
                                streamHandler.typing?.();
                                break;

                            case 'assistant.turn_end':
                                logger.info('Turn end (turn %d, hasContent: %s, bufferLen: %d)', turnCount, hasContentInCurrentTurn, turnContentBuffer.length);
                                if (turnContentBuffer.trim() && streamHandler.sendMessage) {
                                    logger.info('Sending turn %d message (%d chars)', turnCount, turnContentBuffer.trim().length);
                                    const p = streamHandler.sendMessage(turnContentBuffer.trim())
                                        .then(() => logger.info('Turn %d message sent', turnCount))
                                        .catch(err => logger.error('Failed to send turn %d: %O', turnCount, err));
                                    pendingMessages.push(p);
                                }
                                turnCount++;
                                break;

                            case 'assistant.message_delta':
                            case 'assistant.streaming_delta': {
                                const deltaContent = (event.data?.deltaContent || event.data?.content) as string | undefined;
                                if (deltaContent) {
                                    responseContent += deltaContent;
                                    turnContentBuffer += deltaContent;
                                    hasContentInCurrentTurn = true;
                                }
                                break;
                            }

                            case 'assistant.message': {
                                const content = event.data?.content as string | undefined;
                                if (content && !turnContentBuffer.trim()) {
                                    turnContentBuffer = content;
                                    responseContent += content;
                                    hasContentInCurrentTurn = true;
                                }
                                break;
                            }

                            case 'assistant.reasoning_delta': {
                                const reasoningDelta = event.data?.deltaContent as string | undefined;
                                if (reasoningDelta) {
                                    reasoningContent += reasoningDelta;
                                    streamHandler.update?.(`reasoning:${reasoningContent}`);
                                }
                                break;
                            }

                            case 'assistant.reasoning': {
                                const reasoning = event.data?.content as string | undefined;
                                if (reasoning && !reasoningContent) {
                                    reasoningContent = reasoning;
                                    streamHandler.update?.(`reasoning:${reasoningContent}`);
                                }
                                break;
                            }

                            case 'tool.execution_start': {
                                const toolCallId = event.data?.toolCallId as string | undefined;
                                const toolName = (event.data?.toolName || event.data?.name || 'unknown') as string;
                                logger.info('Tool start: %s (toolCallId: %s)', toolName, toolCallId);
                                streamHandler.typing?.();
                                streamHandler.update?.(`🔧 Using tool: ${toolName}`);

                                if (audit && toolCallId) {
                                    audit.logToolStart(toolName, event.data?.arguments as Record<string, unknown>)
                                        .then(auditToolId => pendingTools.set(toolCallId, { auditToolId, toolName }))
                                        .catch(err => logger.error('Audit tool start error: %O', err));
                                }
                                break;
                            }

                            case 'tool.execution_progress': {
                                const progressMessage = event.data?.progressMessage as string | undefined;
                                if (progressMessage) {
                                    streamHandler.update?.(`📋 ${progressMessage}`);
                                }
                                break;
                            }

                            case 'tool.execution_complete': {
                                const toolCallId = event.data?.toolCallId as string | undefined;
                                const pendingTool = toolCallId ? pendingTools.get(toolCallId) : undefined;
                                logger.info('Tool complete: %s (success: %s)', pendingTool?.toolName || 'unknown', event.data?.success);

                                if (audit && toolCallId && pendingTool) {
                                    pendingTools.delete(toolCallId);
                                    audit.logToolComplete(pendingTool.auditToolId, event.data?.result)
                                        .catch(err => logger.error('Audit tool complete error: %O', err));
                                }
                                break;
                            }

                            case 'session.idle':
                                logger.debug('Session idle — waiting for %d pending messages', pendingMessages.length);
                                Promise.all(pendingMessages).then(() => {
                                    streamHandler.close?.();
                                    if (timeoutId) clearTimeout(timeoutId);
                                    if (firstResponseTimeoutId) clearTimeout(firstResponseTimeoutId);
                                    resolve();
                                }).catch(err => {
                                    logger.error('Error sending pending messages: %O', err);
                                    streamHandler.close?.();
                                    if (timeoutId) clearTimeout(timeoutId);
                                    if (firstResponseTimeoutId) clearTimeout(firstResponseTimeoutId);
                                    resolve();
                                });
                                break;

                            case 'session.error': {
                                const errorMessage = (event.data?.message || event.data?.error || 'Unknown session error') as string;
                                logger.error('Session error: %s', errorMessage);
                                if (timeoutId) clearTimeout(timeoutId);
                                if (firstResponseTimeoutId) clearTimeout(firstResponseTimeoutId);
                                reject(new Error(errorMessage));
                                break;
                            }
                        }
                    } catch (error) {
                        logger.error('Event processing error: %O', error);
                    }
                });

                copilotSession.send({ prompt: message }).catch((err) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    reject(err);
                });
            });

            // Complete audit
            if (audit) {
                await audit.completeInteraction(responseContent, reasoningContent || undefined);
            }

            return {
                success: true,
                response: responseContent,
                model: config.model,
                agent: config.agentName,
                sessionId: ctx.session.id,
                reasoning: reasoningContent || undefined,
            };
        } catch (error) {
            logger.error('Streaming error: %O', error);
            if (audit) {
                await audit.completeInteraction(
                    `[Error: ${(error as Error).message}]`,
                    reasoningContent || undefined
                );
            }
            return {
                success: false,
                error: (error as Error).message || 'Failed to process request',
                model: config.model,
                agent: config.agentName,
                sessionId: ctx.session.id,
            };
        } finally {
            if (unsubscribe) {
                try { unsubscribe(); } catch { /* ignore */ }
            }
        }
    };
}

// ============ CopilotService Class ============

/**
 * Framework-agnostic Copilot Service.
 *
 * Encapsulates all Copilot SDK interaction logic including:
 * - Session creation/resume via injected SessionManager
 * - Synchronous and streaming message handling
 * - Audit logging via injected AuditManager
 * - MCP tool integration
 *
 * No singletons, no framework-specific imports.
 */
export class CopilotService {
    private config: CopilotServiceConfig;
    private sessionManager: SessionManager;
    private auditManager: AuditManager | null;
    private log: ILogger;

    constructor(
        config: CopilotServiceConfig,
        sessionManager: SessionManager,
        auditManager?: AuditManager
    ) {
        this.config = config;
        this.sessionManager = sessionManager;
        this.auditManager = auditManager ?? null;
        this.log = config.logger ?? getLogger('service');

        this.log.info('Copilot Service Initialized — CLI: %s, Model: %s, Agent: %s, MCP: %s, Audit: %s',
            this.config.cliUrl,
            this.config.model,
            this.config.agentName,
            this.config.mcpServers ? Object.keys(this.config.mcpServers).join(', ') : 'None',
            this.config.enableAudit ?? true
        );
    }

    /** Get the service configuration */
    getConfig(): {
        cliUrl: string;
        model: string;
        agentName: string;
        auditEnabled: boolean;
        hasMcpServers: boolean;
    } {
        return {
            cliUrl: this.config.cliUrl,
            model: this.config.model,
            agentName: this.config.agentName,
            auditEnabled: this.config.enableAudit ?? true,
            hasMcpServers: !!this.config.mcpServers
        };
    }

    /** Whether audit is enabled and an audit manager is available */
    private get auditEnabled(): boolean {
        return (this.config.enableAudit ?? true) && this.auditManager !== null;
    }

    /**
     * Get the status of a conversation's Copilot session.
     */
    async getConversationSessionStatus(
        conversationId: string,
        username: string
    ): Promise<SessionStatusResult> {
        return this.sessionManager.getSessionStatus(username, conversationId);
    }

    /**
     * End a conversation's Copilot session manually.
     */
    async endConversationSession(
        conversationId: string,
        username: string
    ): Promise<boolean> {
        const result = await this.sessionManager.endSessionByConversationId(username, conversationId);
        return result !== null;
    }

    /**
     * Resume an expired session by creating a new one.
     * The old session is marked as completed and a new session is created.
     */
    async resumeConversationSession(
        conversationId: string,
        userInfo: UserInfo
    ): Promise<SessionInfo | null> {
        // End any existing session for this conversation
        await this.sessionManager.endSessionByConversationId(userInfo.username, conversationId);

        // Create a new session
        const result = await this.sessionManager.resolveSession(userInfo, {
            conversationId,
            agentConfig: { model: this.config.model, agent: this.config.agentName }
        });

        return result.session;
    }

    /**
     * Process a message through the full lifecycle: session management,
     * Copilot client creation/resume, audit, and delegate to user's handleEvent.
     *
     * This is the core pluggable API. The framework manages:
     * - Session resolution (create or resume)
     * - CopilotClient lifecycle (create, resume, cleanup)
     * - Audit logging setup
     *
     * The user's `handleEvent` receives a `ProcessMessageContext` and is responsible
     * for subscribing to events, processing the response, and returning a CopilotResponse.
     *
     * Use `defaultStreamingHandler()` for the standard streaming implementation,
     * or provide your own for custom event processing.
     */
    async processMessage(options: ProcessMessageOptions): Promise<CopilotResponse> {
        const { message, userInfo, handleEvent, conversationId, sessionId, sessionName } = options;
        const effectiveConversationId = conversationId || 'unknown';

        let session: SessionInfo | undefined;
        const auditManager = this.auditEnabled ? this.auditManager : null;

        // Check if session is expired
        if (effectiveConversationId !== 'unknown') {
            const sessionStatus = await this.sessionManager.getSessionStatus(userInfo.username, effectiveConversationId);
            if (sessionStatus.exists && sessionStatus.expired) {
                this.log.info('processMessage: session expired for conversation %s', effectiveConversationId);
                await this.sessionManager.endSessionByConversationId(userInfo.username, effectiveConversationId);

                return {
                    success: false,
                    error: 'Your session has expired. Please send `/resume` to start a new session and continue, or `/new-session` to start fresh.',
                    model: this.config.model,
                    agent: this.config.agentName,
                    sessionExpired: true
                };
            }
        }

        // Resolve session
        try {
            const result = await this.sessionManager.resolveSession(userInfo, {
                sessionId,
                sessionName,
                conversationId: effectiveConversationId,
                agentConfig: { model: this.config.model, agent: this.config.agentName }
            });
            session = result.session;
            this.log.info('processMessage: session resolved (id=%s, isNew=%s)', session.id, result.isNew);
        } catch (error) {
            if (error instanceof SessionNotFoundError || error instanceof SessionExpiredError) {
                this.log.error('processMessage: session resolution failed: %O', error);
                return {
                    success: false,
                    error: error.message,
                    model: this.config.model,
                    agent: this.config.agentName,
                    sessionExpired: error instanceof SessionExpiredError
                };
            }
            this.log.error('processMessage: session resolution failed: %O', error);
            throw error;
        }

        // Create Copilot client and session
        let copilotClient: CopilotClient | undefined;
        let copilotSession: Awaited<ReturnType<CopilotClient['createSession']>> | undefined;

        try {
            copilotClient = new CopilotClient({ cliUrl: this.config.cliUrl });

            const sessionConfig: Record<string, unknown> = {
                model: this.config.model,
                systemMessage: {
                    mode: 'replace',
                    content: this.config.systemPrompt
                },
                streaming: true,
                onPermissionRequest: async (request: { kind: string; toolCallId?: string; [key: string]: unknown }) => {
                    this.log.debug('processMessage: permission request: %O', request);
                    return { kind: 'approved' as const };
                }
            };

            if (this.config.mcpServers) {
                sessionConfig.mcpServers = this.config.mcpServers;
            }

            // Try to resume existing Copilot session, or create new
            if (session.copilot_session_id) {
                try {
                    this.log.info('processMessage: resuming copilot session %s', session.copilot_session_id);
                    copilotSession = await copilotClient.resumeSession(session.copilot_session_id, sessionConfig as any);
                    this.log.info('processMessage: copilot session resumed');
                } catch (resumeError) {
                    this.log.warn('processMessage: resume failed, creating new: %O', resumeError);
                }
            }

            if (!copilotSession) {
                this.log.info('processMessage: creating new copilot session');
                copilotSession = await copilotClient.createSession(sessionConfig as any);
                if (!copilotSession) {
                    throw new Error('Failed to create Copilot session');
                }
                // Store the Copilot session ID for future resume
                const copilotSessionId = copilotSession.sessionId;
                this.log.info('processMessage: copilot session created (id=%s)', copilotSessionId);
                await this.sessionManager.updateCopilotSessionId(
                    userInfo.username,
                    session.id,
                    copilotSessionId
                );
            }

            // Touch session to update last activity
            await this.sessionManager.touchSession(userInfo.username, session.id);

            // Build audit context
            let auditContext: AuditContext | null = null;
            if (auditManager && session) {
                auditManager.setSession(session.id);
                auditContext = {
                    startInteraction: (userQuery: string) => auditManager.startInteraction(userQuery),
                    completeInteraction: async (response?: string, reasoning?: string) => {
                        await auditManager.completeInteraction(response, reasoning);
                    },
                    logToolStart: (toolName: string, args?: Record<string, unknown>) =>
                        auditManager.logToolStart(toolName, args),
                    logToolComplete: (auditToolId: string, result?: unknown) =>
                        auditManager.logToolComplete(auditToolId, result),
                    logToolError: async (auditToolId: string, errorMsg: string) => {
                        await auditManager.logToolError(auditToolId, errorMsg);
                    },
                };
            }

            // Build the context for the user's handler
            this.log.debug('processMessage: building context');
            const ctx: ProcessMessageContext = {
                session,
                copilotSession: copilotSession as ProcessMessageContext['copilotSession'],
                audit: auditContext,
                logger: this.log,
                message,
                userInfo,
                config: {
                    model: this.config.model,
                    agentName: this.config.agentName,
                },
            };

            // Delegate to user's event handler
            const response = await handleEvent(ctx);
            this.log.info('processMessage: handleEvent completed (success=%s)', response.success);
            return response;

        } catch (error) {
            this.log.error('processMessage: handleEvent error: %O', error);
            return {
                success: false,
                error: (error as Error).message || 'Failed to process message',
                model: this.config.model,
                agent: this.config.agentName,
                sessionId: session?.id
            };
        } finally {
            this.log.debug('processMessage: cleaning up copilot client');
            if (copilotClient) {
                try {
                    await copilotClient.stop();
                } catch (cleanupError) {
                    this.log.debug('processMessage: cleanup error (suppressed): %O', cleanupError);
                }
            }
        }
    }

    /**
     * Send a message to Copilot and get a synchronous response.
     */
    async sendMessage(
        message: string,
        userInfo: UserInfo,
        options?: SendMessageOptions
    ): Promise<CopilotResponse> {
        let session: SessionInfo | undefined;
        const auditManager = this.auditEnabled ? this.auditManager : null;

        // Session resolution (always resolve, regardless of audit)
        try {
            const result = await this.sessionManager.resolveSession(userInfo, {
                sessionId: options?.sessionId,
                sessionName: options?.sessionName,
                conversationId: options?.conversationId,
                agentConfig: { model: this.config.model, agent: this.config.agentName }
            });
            session = result.session;
        } catch (error) {
            if (error instanceof SessionNotFoundError || error instanceof SessionExpiredError) {
                return {
                    success: false,
                    error: error.message,
                    model: this.config.model,
                    agent: this.config.agentName,
                    sessionExpired: error instanceof SessionExpiredError
                };
            }
            this.log.error('Session resolution error: %O', error);
            // Continue without session if resolution fails
        }

        let copilotClient: CopilotClient | undefined;

        try {
            // Set up audit
            if (auditManager && session) {
                auditManager.setSession(session.id);
                await auditManager.startInteraction(message);
            }

            copilotClient = new CopilotClient({ cliUrl: this.config.cliUrl });

            this.log.debug('System prompt preview: %s...', this.config.systemPrompt?.substring(0, 200));

            const sessionConfig: Record<string, unknown> = {
                model: this.config.model,
                systemMessage: {
                    mode: 'replace',
                    content: this.config.systemPrompt
                },
                onPermissionRequest: async (request: { kind: string; toolCallId?: string; [key: string]: unknown }) => {
                    this.log.debug('Permission request (non-streaming): %O', request);
                    return { kind: 'approved' as const };
                }
            };

            // Add MCP servers if configured
            if (this.config.mcpServers) {
                sessionConfig.mcpServers = this.config.mcpServers;
            }

            this.log.debug('Session config: %O', { ...sessionConfig, systemMessage: { mode: 'replace', content: '(truncated)' } });

            const copilotSession = await copilotClient.createSession(sessionConfig as any);
            const response = await copilotSession.sendAndWait({ prompt: message });

            this.log.debug('Response: %O', response);

            // Try multiple ways to extract content
            const data = response?.data as Record<string, unknown> | undefined;
            let content = '';
            if (data?.content) {
                content = data.content as string;
            } else if (data?.message) {
                content = data.message as string;
            } else if (typeof data === 'string') {
                content = data;
            } else if (response && typeof response === 'object') {
                const respAny = response as Record<string, unknown>;
                if (respAny.content) content = respAny.content as string;
                else if (respAny.message) content = respAny.message as string;
                else if (respAny.text) content = respAny.text as string;
            }

            this.log.debug('Extracted content: %s', content || '(empty)');

            // Complete audit interaction
            if (auditManager) {
                await auditManager.completeInteraction(content);
            }

            return {
                success: true,
                response: content,
                model: this.config.model,
                agent: this.config.agentName,
                sessionId: session?.id
            };
        } catch (error) {
            this.log.error('Copilot error: %O', error);

            // Log error to audit
            if (auditManager) {
                await auditManager.completeInteraction(`[Error: ${(error as Error).message}]`);
            }

            return {
                success: false,
                error: (error as Error).message || 'Failed to process request',
                model: this.config.model,
                agent: this.config.agentName,
                sessionId: session?.id
            };
        } finally {
            if (copilotClient) {
                try {
                    await copilotClient.stop();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * Send a message to Copilot with streaming response.
     *
     * Delegates to `processMessage()` with `defaultStreamingHandler()`.
     * This is the high-level API for streaming — use `processMessage()` directly
     * if you need custom event handling.
     *
     * @param message - The user message to send
     * @param userInfo - User information for audit logging
     * @param streamHandler - Generic stream handler for streaming responses to the client
     * @param options - Optional session and configuration options
     */
    async sendMessageStreaming(
        message: string,
        userInfo: UserInfo,
        streamHandler: IStreamHandler,
        options?: SendMessageOptions
    ): Promise<CopilotResponse> {
        const response = await this.processMessage({
            message,
            userInfo,
            handleEvent: defaultStreamingHandler(streamHandler, {
                showReasoning: options?.showReasoning,
            }),
            conversationId: options?.conversationId,
            sessionId: options?.sessionId,
            sessionName: options?.sessionName,
        });

        // Enrich with remaining session time if successful
        if (response.success && options?.conversationId) {
            const updatedStatus = await this.sessionManager.getSessionStatus(
                userInfo.username,
                options.conversationId
            );
            if (updatedStatus.remainingTimeMs) {
                response.remainingSessionTime = formatRemainingTime(updatedStatus.remainingTimeMs);
            }
        }

        return response;
    }
}
