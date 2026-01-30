/**
 * In-Memory Mock Data Store for Testing.
 *
 * Implements both ISessionStore and IAuditStore using in-memory Maps
 * for unit testing without requiring a real Cosmos DB connection.
 *
 * This combined mock is convenient for tests that need both stores
 * backed by the same in-memory data. Production code should use
 * SessionCosmosStore and AuditCosmosStore separately.
 */

import type { ISessionStore, IAuditStore } from '@copilot-cli-server/stateless-copilot-sdk';
import type { SessionInfo, Interaction, ToolExecution } from '@copilot-cli-server/stateless-copilot-sdk';

/**
 * In-memory implementation of ISessionStore & IAuditStore for testing purposes.
 */
export class MockDataStore implements ISessionStore, IAuditStore {
    // In-memory storage
    private sessions: Map<string, SessionInfo> = new Map();
    private interactions: Map<string, Interaction> = new Map();
    private toolExecutions: Map<string, ToolExecution> = new Map();
    
    private initialized = false;
    
    /**
     * Initialize the mock data store.
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
        this.sessions.clear();
        this.interactions.clear();
        this.toolExecutions.clear();
    }
    
    /**
     * Get the count of stored items (useful for assertions).
     */
    getCounts(): { sessions: number; interactions: number; toolExecutions: number } {
        return {
            sessions: this.sessions.size,
            interactions: this.interactions.size,
            toolExecutions: this.toolExecutions.size
        };
    }
    
    // ============ Sessions Operations ============
    
    async createSession(sessionData: SessionInfo): Promise<SessionInfo> {
        this.sessions.set(sessionData.id, { ...sessionData });
        return { ...sessionData };
    }
    
    async updateSession(
        sessionId: string,
        _partitionKey: string,
        sessionData: SessionInfo
    ): Promise<SessionInfo> {
        this.sessions.set(sessionId, { ...sessionData });
        return { ...sessionData };
    }
    
    async getSession(sessionId: string, partitionKey: string): Promise<SessionInfo | null> {
        const session = this.sessions.get(sessionId);
        // Verify partition key matches (like Cosmos DB would)
        if (session && session.user_info.username === partitionKey) {
            return { ...session };
        }
        return null;
    }
    
    async getSessionByName(username: string, sessionName: string): Promise<SessionInfo | null> {
        for (const session of this.sessions.values()) {
            if (session.user_info.username === username && session.name === sessionName) {
                return { ...session };
            }
        }
        return null;
    }
    
    async getSessionsByUser(username: string): Promise<SessionInfo[]> {
        const userSessions: SessionInfo[] = [];
        for (const session of this.sessions.values()) {
            if (session.user_info.username === username) {
                userSessions.push({ ...session });
            }
        }
        // Sort by start_time descending
        return userSessions.sort((a, b) => 
            new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
        );
    }
    
    async getSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null> {
        const now = new Date();
        for (const session of this.sessions.values()) {
            if (
                session.user_info.username === username && 
                session.conversation_id === conversationId &&
                session.status === 'active' &&
                (!session.expires_at || new Date(session.expires_at) > now)
            ) {
                return { ...session };
            }
        }
        return null;
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