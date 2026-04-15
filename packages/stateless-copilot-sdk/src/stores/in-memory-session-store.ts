/**
 * In-Memory Session Store.
 *
 * Implements ISessionStore using in-memory Maps for unit testing
 * without requiring a real database connection.
 */

import type { ISessionStore } from '../interfaces.js';
import type { SessionInfo } from '../models.js';

/**
 * In-memory implementation of ISessionStore for testing purposes.
 */
export class InMemorySessionStore implements ISessionStore {
    private sessions: Map<string, SessionInfo> = new Map();
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
        this.sessions.clear();
    }

    /**
     * Get the count of stored items (useful for assertions).
     */
    getCounts(): { sessions: number } {
        return {
            sessions: this.sessions.size
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

    async getLastSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null> {
        let latest: SessionInfo | null = null;
        for (const session of this.sessions.values()) {
            if (
                session.user_info.username === username &&
                session.conversation_id === conversationId
            ) {
                if (!latest || new Date(session.start_time).getTime() > new Date(latest.start_time).getTime()) {
                    latest = session;
                }
            }
        }
        return latest ? { ...latest } : null;
    }
}
