/**
 * In-Memory Audit Store.
 *
 * Implements IAuditStore using in-memory Maps for unit testing
 * without requiring a real database connection.
 */

import type { IAuditStore } from '../interfaces.js';
import type { Interaction, ToolExecution } from '../models.js';

/**
 * In-memory implementation of IAuditStore for testing purposes.
 */
export class InMemoryAuditStore implements IAuditStore {
    private interactions: Map<string, Interaction> = new Map();
    private toolExecutions: Map<string, ToolExecution> = new Map();
    private initialized = false;

    /**
     * Initialize the store.
     */
    async initialize(): Promise<void> {
        this.initialized = true;
    }

    /**
     * Check if the store is initialized.
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Clear all data (useful for test setup/teardown).
     */
    clear(): void {
        this.interactions.clear();
        this.toolExecutions.clear();
    }

    /**
     * Get the count of stored items (useful for assertions).
     */
    getCounts(): { interactions: number; toolExecutions: number } {
        return {
            interactions: this.interactions.size,
            toolExecutions: this.toolExecutions.size
        };
    }

    // ============ Interactions Operations ============

    async createInteraction(interactionData: Interaction): Promise<Interaction> {
        this.interactions.set(interactionData.id, { ...interactionData });
        return { ...interactionData };
    }

    async updateInteraction(
        interactionId: string,
        _partitionKey: string,
        interactionData: Interaction
    ): Promise<Interaction> {
        this.interactions.set(interactionId, { ...interactionData });
        return { ...interactionData };
    }

    async getInteractionsBySession(sessionId: string): Promise<Interaction[]> {
        const sessionInteractions: Interaction[] = [];
        for (const interaction of this.interactions.values()) {
            if (interaction.session_id === sessionId) {
                sessionInteractions.push({ ...interaction });
            }
        }
        // Sort by timestamp
        return sessionInteractions.sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    }

    // ============ Tool Executions Operations ============

    async createToolExecution(toolData: ToolExecution): Promise<ToolExecution> {
        this.toolExecutions.set(toolData.id, { ...toolData });
        return { ...toolData };
    }

    async updateToolExecution(
        toolId: string,
        _partitionKey: string,
        toolData: ToolExecution
    ): Promise<ToolExecution> {
        this.toolExecutions.set(toolId, { ...toolData });
        return { ...toolData };
    }

    async getToolExecutionsBySession(sessionId: string): Promise<ToolExecution[]> {
        const sessionTools: ToolExecution[] = [];
        for (const tool of this.toolExecutions.values()) {
            if (tool.session_id === sessionId) {
                sessionTools.push({ ...tool });
            }
        }
        // Sort by start_time
        return sessionTools.sort((a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        );
    }

    async getToolExecutionsByInteraction(
        sessionId: string,
        interactionId: string
    ): Promise<ToolExecution[]> {
        const interactionTools: ToolExecution[] = [];
        for (const tool of this.toolExecutions.values()) {
            if (tool.session_id === sessionId && tool.interaction_id === interactionId) {
                interactionTools.push({ ...tool });
            }
        }
        // Sort by start_time
        return interactionTools.sort((a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        );
    }
}
