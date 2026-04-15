/**
 * Data models for the Audit System.
 * 
 * Defines the data structures for Sessions, Interactions, and Tool Executions.
 * Compatible with Cosmos DB schema from the Python reference implementation.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from './logger.js';

// ============ Enums ============

export enum SessionStatus {
    ACTIVE = 'active',
    COMPLETED = 'completed',
    ERROR = 'error'
}

export enum ToolExecutionStatus {
    STARTED = 'started',
    COMPLETED = 'completed',
    ERROR = 'error'
}

// ============ Interfaces ============

export interface UserInfo {
    /** OS username or authenticated user identity */
    username: string;
    /** Machine hostname or client identifier */
    hostname: string;
}

export interface SessionInfo {
    /** Unique session ID (Cosmos DB document ID) */
    id: string;
    /** Optional user-provided session name (unique per user) */
    name?: string;
    /** User details */
    user_info: UserInfo;
    /** Session start timestamp (ISO 8601) */
    start_time: string;
    /** Session end timestamp (ISO 8601) */
    end_time?: string;
    /** Current session status */
    status: SessionStatus;
    /** Agent configuration used */
    agent_config?: Record<string, unknown>;
    /** Copilot SDK session ID for resuming sessions across stateless container instances */
    copilot_session_id?: string;
    /** Teams/Bot conversation ID for mapping Teams conversations to sessions */
    conversation_id?: string;
    /** Session expiration timestamp (ISO 8601) - 12 hours from creation */
    expires_at?: string;
    /** Last activity timestamp (ISO 8601) */
    last_activity_at?: string;
}

export interface Interaction {
    /** Unique interaction ID (Cosmos DB document ID) */
    id: string;
    /** Parent session ID (partition key) */
    session_id: string;
    /** User's input prompt */
    user_query: string;
    /** Agent's final response */
    copilot_response?: string;
    /** IDs of tool executions in this interaction */
    tool_execution_ids: string[];
    /** Interaction timestamp (ISO 8601) */
    timestamp: string;
    /** Agent's reasoning (if captured) */
    reasoning?: string;
}

export interface ToolExecution {
    /** Unique tool execution ID (Cosmos DB document ID) */
    id: string;
    /** Parent session ID (partition key) */
    session_id: string;
    /** Parent interaction ID */
    interaction_id?: string;
    /** Name of the tool executed */
    tool_name: string;
    /** Tool input arguments */
    arguments?: Record<string, unknown>;
    /** Tool execution result */
    result?: unknown;
    /** Execution status */
    status: ToolExecutionStatus;
    /** Execution start timestamp (ISO 8601) */
    start_time: string;
    /** Execution end timestamp (ISO 8601) */
    end_time?: string;
    /** Error message if execution failed */
    error_message?: string;
}

export interface CopilotResponse {
    success: boolean;
    response?: string;
    error?: string;
    model: string;
    agent: string;
    sessionId?: string;
    reasoning?: string;
    sessionExpired?: boolean;
    remainingSessionTime?: string;
}

// ============ MCP Configuration Types ============

export interface MCPServerConfigInput {
    tools?: string[];
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface ToolsConfig {
    mcp_servers?: Record<string, MCPServerConfigInput>;
}

export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    tools?: string[];
}

// ============ Stream Handler ============

/** Generic stream handler interface - framework agnostic replacement for Teams IStreamer */
export interface IStreamHandler {
    /** Emit content to the current streaming message (used for status only) */
    emit(content: string): void;
    /** Update status/progress (optional, transient) */
    update?(status: string): void;
    /** Send a complete separate message */
    sendMessage?(content: string): Promise<void>;
    /** Send typing indicator */
    typing?(): void;
    /** Close the stream */
    close?(): void;
}

// ============ Process Message Context ============

/**
 * Audit helpers exposed to handleEvent callbacks.
 * Provides a simplified interface for logging interactions and tools
 * without requiring direct access to the AuditManager.
 */
export interface AuditContext {
    /** Start a new interaction (user turn). Returns interaction ID. */
    startInteraction(userQuery: string): Promise<string>;
    /** Complete the current interaction with the agent's response. */
    completeInteraction(response?: string, reasoning?: string): Promise<void>;
    /** Log the start of a tool execution. Returns audit tool ID. */
    logToolStart(toolName: string, args?: Record<string, unknown>): Promise<string>;
    /** Log the completion of a tool execution. */
    logToolComplete(auditToolId: string, result?: unknown): Promise<void>;
    /** Log a tool error. */
    logToolError(auditToolId: string, error: string): Promise<void>;
}

/**
 * Context passed to the user's handleEvent callback.
 * Provides everything needed to interact with the copilot session.
 */
export interface ProcessMessageContext {
    /** The resolved session info */
    session: SessionInfo;
    /** The copilot SDK session (subscribe to events, send messages) */
    copilotSession: {
        /** Subscribe to copilot events */
        on(handler: (event: { type: string; data?: Record<string, unknown> }) => void): () => void;
        /** Send a message to the copilot */
        send(params: { prompt: string }): Promise<void>;
        /** Send and wait for response (non-streaming) */
        sendAndWait?(params: { prompt: string }): Promise<unknown>;
        /** The copilot session ID */
        sessionId: string;
    };
    /** Audit helpers (null if audit is disabled) */
    audit: AuditContext | null;
    /** Logger scoped to this request */
    logger: ILogger;
    /** The user's message */
    message: string;
    /** User info for this request */
    userInfo: UserInfo;
    /** Service configuration */
    config: {
        model: string;
        agentName: string;
    };
}

/**
 * Function signature for the user's event handler.
 * The framework calls this after setting up the session and copilot client.
 * The handler is responsible for subscribing to events and processing the response.
 */
export type HandleEventFn = (ctx: ProcessMessageContext) => Promise<CopilotResponse>;

/**
 * Options for processMessage().
 */
export interface ProcessMessageOptions {
    /** The user message to send */
    message: string;
    /** User information */
    userInfo: UserInfo;
    /** The event handler that processes copilot events */
    handleEvent: HandleEventFn;
    /** Conversation ID for session persistence */
    conversationId?: string;
    /** Explicit session ID to resume */
    sessionId?: string;
    /** Session name */
    sessionName?: string;
}

// ============ Constants ============

// Default session expiration time (12 hours in milliseconds)
export const SESSION_EXPIRATION_MS = 12 * 60 * 60 * 1000;

// ============ Factory Functions ============

export function createSessionInfo(
    userInfo: UserInfo,
    options?: {
        name?: string;
        agentConfig?: Record<string, unknown>;
        conversationId?: string;
        copilotSessionId?: string;
        /** Session expiration duration in milliseconds (default: SESSION_EXPIRATION_MS / 12 hours) */
        expirationMs?: number;
    }
): SessionInfo {
    const now = new Date();
    return {
        id: uuidv4(),
        name: options?.name,
        user_info: userInfo,
        start_time: now.toISOString(),
        status: SessionStatus.ACTIVE,
        agent_config: options?.agentConfig,
        copilot_session_id: options?.copilotSessionId,
        conversation_id: options?.conversationId,
        expires_at: new Date(now.getTime() + (options?.expirationMs ?? SESSION_EXPIRATION_MS)).toISOString(),
        last_activity_at: now.toISOString()
    };
}

export function createInteraction(
    sessionId: string,
    userQuery: string
): Interaction {
    return {
        id: uuidv4(),
        session_id: sessionId,
        user_query: userQuery,
        tool_execution_ids: [],
        timestamp: new Date().toISOString()
    };
}

export function createToolExecution(
    sessionId: string,
    toolName: string,
    options?: {
        interactionId?: string;
        arguments?: Record<string, unknown>;
    }
): ToolExecution {
    return {
        id: uuidv4(),
        session_id: sessionId,
        interaction_id: options?.interactionId,
        tool_name: toolName,
        arguments: options?.arguments,
        status: ToolExecutionStatus.STARTED,
        start_time: new Date().toISOString()
    };
}

// ============ Helper Functions ============

/**
 * Get the partition key for a session (username)
 */
export function getSessionPartitionKey(session: SessionInfo): string {
    return session.user_info.username;
}

/**
 * Get the partition key for an interaction (session_id)
 */
export function getInteractionPartitionKey(interaction: Interaction): string {
    return interaction.session_id;
}

/**
 * Get the partition key for a tool execution (session_id)
 */
export function getToolExecutionPartitionKey(toolExecution: ToolExecution): string {
    return toolExecution.session_id;
}
