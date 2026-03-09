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
    IStreamHandler
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
    /** MCP server configurations */
    mcpServers?: MCPServerConfig[];
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
): MCPServerConfig[] | undefined {
    if (!toolsConfig || !toolsConfig.mcp_servers) {
        return undefined;
    }

    const mcpServers: MCPServerConfig[] = [];

    // Merge extra env vars (e.g., managed identity from Container Apps runtime)
    const envOverrides: Record<string, string> = { ...(extraEnv || {}) };
    if (process.env.IDENTITY_ENDPOINT) {
        envOverrides.IDENTITY_ENDPOINT = process.env.IDENTITY_ENDPOINT;
    }
    if (process.env.IDENTITY_HEADER) {
        envOverrides.IDENTITY_HEADER = process.env.IDENTITY_HEADER;
    }

    for (const [serverName, serverConfig] of Object.entries(toolsConfig.mcp_servers)) {
        const mergedEnv = { ...envOverrides, ...(serverConfig.env || {}) };

        mcpServers.push({
            name: serverName,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: mergedEnv,
            tools: serverConfig.tools || ['*']
        });
    }

    return mcpServers.length > 0 ? mcpServers : undefined;
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
            this.config.mcpServers ? this.config.mcpServers.map(s => s.name).join(', ') : 'None',
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
                }
            };

            // Add MCP servers if configured
            if (this.config.mcpServers) {
                sessionConfig.mcpServers = this.config.mcpServers;
            }

            this.log.debug('Session config: %O', { ...sessionConfig, systemMessage: { mode: 'replace', content: '(truncated)' } });

            const copilotSession = await copilotClient.createSession(sessionConfig);
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
     * STATELESS SESSION MANAGEMENT:
     * - Sessions are persisted via SessionManager, enabling horizontal scaling
     * - Copilot SDK session IDs are stored for cross-container resume capability
     * - First message creates a new session (valid for 12 hours)
     * - Subsequent messages resume the session using stored Copilot session ID
     * - Sessions expire after 12 hours from creation
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
        const conversationId = options?.conversationId || 'unknown';

        let session: SessionInfo | undefined;
        const auditManager = this.auditEnabled ? this.auditManager : null;
        // Map toolCallId -> { auditToolId, toolName } for tracking tool lifecycle
        const pendingTools: Map<string, { auditToolId: string; toolName: string }> = new Map();
        let responseContent = '';  // Full accumulated content for audit
        let reasoningContent = '';
        // Track if we've emitted any content in the current turn (for newline separation)
        let hasContentInCurrentTurn = false;

        // Check if session is expired
        const sessionStatus = await this.sessionManager.getSessionStatus(userInfo.username, conversationId);
        if (sessionStatus.exists && sessionStatus.expired) {
            this.log.info('Session expired for conversation %s', conversationId);
            // End the expired session
            await this.sessionManager.endSessionByConversationId(userInfo.username, conversationId);

            return {
                success: false,
                error: 'Your session has expired. Please send `/resume` to start a new session and continue, or `/new-session` to start fresh.',
                model: this.config.model,
                agent: this.config.agentName,
                sessionExpired: true
            };
        }

        // Resolve session (will create new or return existing)
        let isNewCopilotSession = false;
        try {
            const result = await this.sessionManager.resolveSession(userInfo, {
                sessionId: options?.sessionId,
                sessionName: options?.sessionName,
                conversationId,
                agentConfig: { model: this.config.model, agent: this.config.agentName }
            });
            session = result.session;
            isNewCopilotSession = result.isNew || !session.copilot_session_id;

            this.log.info('Resolved session: %s, isNew: %s, hasCopilotSessionId: %s', session.id, result.isNew, !!session.copilot_session_id);
        } catch (error) {
            if (error instanceof SessionNotFoundError || error instanceof SessionExpiredError) {
                this.log.error('Session error: %s', error.message);
                return {
                    success: false,
                    error: error.message,
                    model: this.config.model,
                    agent: this.config.agentName,
                    sessionExpired: error instanceof SessionExpiredError
                };
            }
            this.log.error('Session resolution error: %O', error);
            throw error;
        }

        // Create Copilot client and session
        let copilotClient: CopilotClient | undefined;
        let copilotSession: Awaited<ReturnType<CopilotClient['createSession']>> | undefined;
        let unsubscribe: (() => void) | undefined;

        try {
            copilotClient = new CopilotClient({ cliUrl: this.config.cliUrl });

            // Build session config
            const sessionConfig: Record<string, unknown> = {
                model: this.config.model,
                systemMessage: {
                    mode: 'replace',
                    content: this.config.systemPrompt
                },
                streaming: true,
                onPermissionRequest: async (request: { kind: string; toolCallId?: string; [key: string]: unknown }) => {
                    this.log.debug('Permission request: %O', request);
                    return { kind: 'approved' as const };
                }
            };

            // Add MCP servers if configured
            if (this.config.mcpServers) {
                sessionConfig.mcpServers = this.config.mcpServers;
                this.log.debug('MCP servers: %O', this.config.mcpServers);
            }

            // Try to resume existing Copilot session, or create new
            if (!isNewCopilotSession && session!.copilot_session_id) {
                try {
                    this.log.info('Attempting to resume Copilot session: %s', session!.copilot_session_id);
                    copilotSession = await copilotClient.resumeSession(session!.copilot_session_id, sessionConfig);
                    this.log.info('Successfully resumed Copilot session: %s', session!.copilot_session_id);
                } catch (resumeError) {
                    this.log.warn('Failed to resume Copilot session, creating new: %O', resumeError);
                    isNewCopilotSession = true;
                }
            }

            // Create new session if needed
            if (!copilotSession) {
                this.log.info('Creating new Copilot session for conversation %s', conversationId);
                copilotSession = await copilotClient.createSession(sessionConfig);

                if (!copilotSession) {
                    throw new Error('Failed to create Copilot session');
                }

                // Store the Copilot session ID for future resume
                if (session) {
                    const copilotSessionId = copilotSession.sessionId;
                    this.log.info('Storing Copilot session ID: %s', copilotSessionId);
                    await this.sessionManager.updateCopilotSessionId(
                        userInfo.username,
                        session.id,
                        copilotSessionId
                    );
                }
            }

            // Touch session to update last activity
            if (session) {
                await this.sessionManager.touchSession(userInfo.username, session.id);
            }

            // Set up audit
            if (auditManager && session) {
                auditManager.setSession(session.id);
                await auditManager.startInteraction(message);
            }

            // Set up event handlers for streaming
            const STREAM_TIMEOUT = 600000; // 10 minutes
            let timeoutId: ReturnType<typeof setTimeout> | undefined;

            await new Promise<void>((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    this.log.error('Streaming timed out after %d ms', STREAM_TIMEOUT);
                    reject(new Error('Streaming timed out'));
                }, STREAM_TIMEOUT);

                unsubscribe = copilotSession!.on((event: { type: string; data?: Record<string, unknown> }) => {
                    try {
                        this.log.debug('Event: %s, data: %O', event.type, event.data);

                        switch (event.type) {
                            case 'assistant.turn_start':
                                this.log.debug('Turn start');
                                hasContentInCurrentTurn = false;
                                break;

                            case 'assistant.turn_end':
                                this.log.debug('Turn end');
                                // Add newline separator between turns for clarity
                                if (hasContentInCurrentTurn) {
                                    streamHandler.emit('\n\n');
                                    responseContent += '\n\n';
                                }
                                break;

                            case 'assistant.message_delta': {
                                // Streaming delta - extract deltaContent from the event data
                                const deltaContent = event.data?.deltaContent as string | undefined;
                                if (deltaContent) {
                                    this.log.debug('Delta: %s', deltaContent);
                                    responseContent += deltaContent;
                                    hasContentInCurrentTurn = true;
                                    // Stream directly for responsive UX
                                    streamHandler.emit(deltaContent);
                                } else {
                                    this.log.debug('No deltaContent in event data');
                                }
                                break;
                            }

                            case 'assistant.message': {
                                // Final complete message for this turn
                                // Content was already streamed via deltas, this is just for logging
                                const content = event.data?.content as string | undefined;
                                if (content) {
                                    this.log.debug('Final message: %s...', content.substring(0, 100));
                                }
                                break;
                            }

                            case 'assistant.reasoning_delta': {
                                // Reasoning delta
                                const reasoningDelta = event.data?.deltaContent as string | undefined;
                                if (reasoningDelta) {
                                    this.log.debug('Reasoning delta: %s', reasoningDelta);
                                    reasoningContent += reasoningDelta;
                                    // Optionally show reasoning as status updates
                                    if (options?.showReasoning) {
                                        streamHandler.update?.(`Thinking: ${reasoningDelta}`);
                                    }
                                }
                                break;
                            }

                            case 'assistant.reasoning': {
                                // Final complete reasoning - always sent regardless of streaming
                                const reasoning = event.data?.content as string | undefined;
                                if (reasoning) {
                                    this.log.debug('Final reasoning: %s...', reasoning.substring(0, 100));
                                    if (!reasoningContent) {
                                        reasoningContent = reasoning;
                                    }
                                }
                                break;
                            }

                            case 'tool.execution_start': {
                                const toolCallId = event.data?.toolCallId as string | undefined;
                                const toolName = (event.data?.toolName || event.data?.name || 'unknown') as string;
                                this.log.info('Tool start: %s (toolCallId: %s)', toolName, toolCallId);

                                // Emit tool usage as content so user can see it
                                const toolMessage = `\n\n🔧 *Using tool: ${toolName}*\n\n`;
                                streamHandler.emit(toolMessage);
                                responseContent += toolMessage;

                                // Log tool start to audit using toolCallId as key
                                if (auditManager && toolCallId) {
                                    auditManager.logToolStart(toolName, event.data?.arguments as Record<string, unknown>)
                                        .then(auditToolId => pendingTools.set(toolCallId, { auditToolId, toolName }))
                                        .catch(err => this.log.error('Audit tool start error: %O', err));
                                }
                                break;
                            }

                            case 'tool.execution_progress': {
                                // Tool execution progress - show to user
                                const progressMessage = event.data?.progressMessage as string | undefined;
                                if (progressMessage) {
                                    this.log.debug('Tool progress: %s', progressMessage);
                                    const formattedProgress = `📋 *${progressMessage}*\n`;
                                    streamHandler.emit(formattedProgress);
                                    responseContent += formattedProgress;
                                }
                                break;
                            }

                            case 'tool.execution_complete': {
                                const toolCallId = event.data?.toolCallId as string | undefined;
                                const pendingTool = toolCallId ? pendingTools.get(toolCallId) : undefined;
                                const toolName = pendingTool?.toolName || 'unknown';
                                const success = event.data?.success as boolean | undefined;
                                this.log.info('Tool complete: %s (toolCallId: %s, success: %s)', toolName, toolCallId, success);

                                // Log tool complete to audit
                                if (auditManager && toolCallId && pendingTool) {
                                    pendingTools.delete(toolCallId);
                                    auditManager.logToolComplete(pendingTool.auditToolId, event.data?.result)
                                        .catch(err => this.log.error('Audit tool complete error: %O', err));
                                }
                                break;
                            }

                            case 'session.idle':
                                this.log.debug('Session idle — streaming complete');
                                if (timeoutId) clearTimeout(timeoutId);
                                resolve();
                                break;

                            case 'session.error': {
                                const errorMessage = (event.data?.message || event.data?.error || 'Unknown session error') as string;
                                this.log.error('Session error: %s', errorMessage);
                                if (timeoutId) clearTimeout(timeoutId);
                                reject(new Error(errorMessage));
                                break;
                            }

                            default:
                                this.log.debug('Unknown event type: %s', event.type);
                                break;
                        }
                    } catch (error) {
                        this.log.error('Event processing error: %O', error);
                    }
                });

                // Use session.send() for streaming (not sendAndWait which blocks)
                // The session.idle event will signal completion
                copilotSession!.send({ prompt: message }).catch((err) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    reject(err);
                });
            });

            // Complete audit interaction
            if (auditManager) {
                await auditManager.completeInteraction(responseContent, reasoningContent || undefined);
            }

            // Get remaining session time
            const updatedStatus = await this.sessionManager.getSessionStatus(userInfo.username, conversationId);
            const remainingTime = updatedStatus.remainingTimeMs
                ? formatRemainingTime(updatedStatus.remainingTimeMs)
                : undefined;

            return {
                success: true,
                response: responseContent,
                model: this.config.model,
                agent: this.config.agentName,
                sessionId: session?.id,
                reasoning: reasoningContent || undefined,
                remainingSessionTime: remainingTime
            };

        } catch (error) {
            this.log.error('Streaming error: %O', error);

            // Log error to audit
            if (auditManager) {
                await auditManager.completeInteraction(
                    `[Error: ${(error as Error).message}]`,
                    reasoningContent || undefined
                );
            }

            return {
                success: false,
                error: (error as Error).message || 'Failed to process request',
                model: this.config.model,
                agent: this.config.agentName,
                sessionId: session?.id
            };
        } finally {
            if (unsubscribe) {
                try {
                    unsubscribe();
                } catch {
                    // Ignore unsubscribe errors
                }
            }

            // Clean up Copilot client - we create a new one for each request
            // The session ID is persisted for stateless resume
            if (copilotClient) {
                try {
                    await copilotClient.stop();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
}
