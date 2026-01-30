/**
 * Persistence interfaces for the Copilot Core package.
 *
 * Split into two concerns:
 * - ISessionStore: session persistence (required for session management)
 * - IAuditStore: audit data persistence (optional for audit logging)
 */

import type { SessionInfo, Interaction, ToolExecution } from './models.js';

/**
 * Interface for session persistence.
 * Implementations can use any database backend.
 */
export interface ISessionStore {
    /** Initialize the store and create any required structures. */
    initialize(): Promise<void>;

    /** Create a new session record. */
    createSession(sessionData: SessionInfo): Promise<SessionInfo>;

    /** Update an existing session record. */
    updateSession(sessionId: string, partitionKey: string, sessionData: SessionInfo): Promise<SessionInfo>;

    /** Get a session by ID and partition key. */
    getSession(sessionId: string, partitionKey: string): Promise<SessionInfo | null>;

    /** Get a session by name for a specific user. */
    getSessionByName(username: string, sessionName: string): Promise<SessionInfo | null>;

    /** Get all sessions for a user. */
    getSessionsByUser(username: string): Promise<SessionInfo[]>;

    /** Get an active session by conversation ID for a user. */
    getSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null>;
}

/**
 * Interface for audit data persistence.
 * Implementations can use any database backend.
 */
export interface IAuditStore {
    /** Initialize the store and create any required structures. */
    initialize(): Promise<void>;

    /** Create a new interaction record. */
    createInteraction(interactionData: Interaction): Promise<Interaction>;

    /** Update an existing interaction record. */
    updateInteraction(interactionId: string, partitionKey: string, interactionData: Interaction): Promise<Interaction>;

    /** Get all interactions for a session. */
    getInteractionsBySession(sessionId: string): Promise<Interaction[]>;

    /** Create a new tool execution record. */
    createToolExecution(toolData: ToolExecution): Promise<ToolExecution>;

    /** Update an existing tool execution record. */
    updateToolExecution(toolId: string, partitionKey: string, toolData: ToolExecution): Promise<ToolExecution>;

    /** Get all tool executions for a session. */
    getToolExecutionsBySession(sessionId: string): Promise<ToolExecution[]>;

    /** Get all tool executions for a specific interaction. */
    getToolExecutionsByInteraction(sessionId: string, interactionId: string): Promise<ToolExecution[]>;
}
