/**
 * Audit Manager - High-level interface for Audit Logging.
 *
 * Provides a simple API for logging interactions and tool executions
 * within a session context. Requires an injected IAuditStore implementation.
 */

import type { IAuditStore } from './interfaces.js';
import {
    Interaction,
    ToolExecution,
    ToolExecutionStatus,
    createInteraction,
    createToolExecution,
    getInteractionPartitionKey,
    getToolExecutionPartitionKey
} from './models.js';

export interface AuditManagerOptions {
    /** Audit store implementation (required) */
    store: IAuditStore;
}

/**
 * Audit Manager for logging interactions and tool executions.
 *
 * Usage:
 *   const audit = new AuditManager({ store: myAuditStore });
 *   audit.setSession(sessionId);
 *
 *   // For each user turn:
 *   const interactionId = await audit.startInteraction(userQuery);
 *
 *   // Log tool calls as they happen
 *   const toolId = await audit.logToolStart(toolName, args);
 *   await audit.logToolComplete(toolId, result);
 *
 *   // Complete interaction when agent responds
 *   await audit.completeInteraction(response, reasoning);
 */
export class AuditManager {
    private db: IAuditStore;
    private initialized = false;

    private currentSessionId: string | null = null;
    private currentInteraction: Interaction | null = null;
    private pendingToolExecutions: Map<string, ToolExecution> = new Map();

    constructor(options: AuditManagerOptions) {
        this.db = options.store;
    }

    /**
     * Initialize the audit manager and underlying store connection.
     */
    async initialize(): Promise<void> {
        if (!this.initialized) {
            await this.db.initialize();
            this.initialized = true;
            console.log('Audit Manager initialized.');
        }
    }

    /**
     * Set the current session ID for logging.
     * Must be called before logging interactions or tool executions.
     */
    setSession(sessionId: string): void {
        this.currentSessionId = sessionId;
        this.currentInteraction = null;
        this.pendingToolExecutions.clear();
        console.log(`Audit Manager: Session set to ${sessionId}`);
    }

    /**
     * Get the current session ID.
     */
    get sessionId(): string | null {
        return this.currentSessionId;
    }

    /**
     * Get the current interaction ID.
     */
    get interactionId(): string | null {
        return this.currentInteraction?.id ?? null;
    }

    // ============ Interaction Management ============

    /**
     * Start a new interaction (user turn).
     *
     * @param userQuery The user's input prompt.
     * @returns The interaction ID.
     * @throws Error if no active session.
     */
    async startInteraction(userQuery: string): Promise<string> {
        await this.initialize();

        if (!this.currentSessionId) {
            throw new Error('Cannot start interaction without an active session. Call setSession() first.');
        }

        // Complete any previous interaction that wasn't explicitly completed
        if (this.currentInteraction) {
            await this.completeInteraction('[Interrupted by new query]');
        }

        const interaction = createInteraction(this.currentSessionId, userQuery);

        // Persist immediately
        await this.db.createInteraction(interaction);

        this.currentInteraction = interaction;
        console.log(`Started interaction: ${interaction.id} for query: ${userQuery.substring(0, 50)}...`);

        return interaction.id;
    }

    /**
     * Complete the current interaction with the agent's response.
     *
     * @param copilotResponse The agent's final response text.
     * @param reasoning Optional reasoning/thinking captured during the turn.
     * @returns The completed interaction or null if no active interaction.
     */
    async completeInteraction(
        copilotResponse?: string,
        reasoning?: string
    ): Promise<Interaction | null> {
        if (!this.currentInteraction) {
            console.warn('No active interaction to complete.');
            return null;
        }

        this.currentInteraction.copilot_response = copilotResponse;
        this.currentInteraction.reasoning = reasoning;

        // Update in store
        await this.db.updateInteraction(
            this.currentInteraction.id,
            getInteractionPartitionKey(this.currentInteraction),
            this.currentInteraction
        );

        console.log(`Completed interaction: ${this.currentInteraction.id}`);

        const completedInteraction = this.currentInteraction;
        this.currentInteraction = null;

        return completedInteraction;
    }

    // ============ Tool Execution Logging ============

    /**
     * Log the start of a tool execution.
     *
     * @param toolName Name of the tool being executed.
     * @param args Input arguments to the tool.
     * @returns The tool execution ID.
     * @throws Error if no active session.
     */
    async logToolStart(
        toolName: string,
        args?: Record<string, unknown>
    ): Promise<string> {
        await this.initialize();

        if (!this.currentSessionId) {
            throw new Error('Cannot log tool execution without an active session.');
        }

        const toolExecution = createToolExecution(this.currentSessionId, toolName, {
            interactionId: this.currentInteraction?.id,
            arguments: args
        });

        // Persist to store
        await this.db.createToolExecution(toolExecution);

        // Track pending execution
        this.pendingToolExecutions.set(toolExecution.id, toolExecution);

        // Add to current interaction's tool list
        if (this.currentInteraction) {
            this.currentInteraction.tool_execution_ids.push(toolExecution.id);
        }

        console.log(`Tool execution started: ${toolExecution.id} - ${toolName}`);

        return toolExecution.id;
    }

    /**
     * Log the completion of a tool execution.
     *
     * @param toolId The tool execution ID returned from logToolStart.
     * @param result The result returned by the tool.
     * @param errorMessage Error message if the tool failed.
     * @returns The updated ToolExecution object, or null if tool_id not found.
     */
    async logToolComplete(
        toolId: string,
        result?: unknown,
        errorMessage?: string
    ): Promise<ToolExecution | null> {
        const toolExecution = this.pendingToolExecutions.get(toolId);

        if (!toolExecution) {
            console.warn(`Tool execution not found: ${toolId}`);
            return null;
        }

        this.pendingToolExecutions.delete(toolId);

        toolExecution.end_time = new Date().toISOString();
        toolExecution.result = result;
        toolExecution.error_message = errorMessage;
        toolExecution.status = errorMessage
            ? ToolExecutionStatus.ERROR
            : ToolExecutionStatus.COMPLETED;

        // Update in store
        await this.db.updateToolExecution(
            toolExecution.id,
            getToolExecutionPartitionKey(toolExecution),
            toolExecution
        );

        console.log(`Tool execution completed: ${toolId} - status: ${toolExecution.status}`);

        return toolExecution;
    }

    /**
     * Log a complete tool execution in one call (start + complete).
     *
     * @param toolName Name of the tool executed.
     * @param args Input arguments to the tool.
     * @param result The result returned by the tool.
     * @param errorMessage Error message if the tool failed.
     * @returns The ToolExecution object.
     */
    async logToolExecution(
        toolName: string,
        args?: Record<string, unknown>,
        result?: unknown,
        errorMessage?: string
    ): Promise<ToolExecution | null> {
        const toolId = await this.logToolStart(toolName, args);
        return this.logToolComplete(toolId, result, errorMessage);
    }

    // ============ Query Methods ============

    /**
     * Get all interactions for the current session.
     */
    async getSessionInteractions(): Promise<Interaction[]> {
        if (!this.currentSessionId) {
            return [];
        }
        return this.db.getInteractionsBySession(this.currentSessionId);
    }

    /**
     * Get all tool executions for the current session.
     */
    async getSessionToolExecutions(): Promise<ToolExecution[]> {
        if (!this.currentSessionId) {
            return [];
        }
        return this.db.getToolExecutionsBySession(this.currentSessionId);
    }
}
