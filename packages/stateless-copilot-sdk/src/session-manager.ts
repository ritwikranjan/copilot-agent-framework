/**
 * Session Manager - High-level interface for Session Management.
 *
 * Provides methods for creating, resuming, and managing sessions.
 * Implements the session resolution logic based on sessionId, sessionName, or conversationId.
 *
 * The store implementation is injected via constructor — no default backend.
 */

import type { ISessionStore } from './interfaces.js';
import type { ILogger } from './logger.js';
import { getLogger } from './logger.js';
import {
    SessionInfo,
    SessionStatus,
    SESSION_EXPIRATION_MS,
    UserInfo,
    SessionShare,
    ShareRole,
    createSessionInfo,
    createSessionShare,
    getSessionPartitionKey
} from './models.js';

export interface SessionResolveResult {
    session: SessionInfo;
    isNew: boolean;
}

export interface SessionManagerOptions {
    /** Session store implementation (required) */
    store: ISessionStore;
    /** Optional custom logger (defaults to debug-based logger) */
    logger?: ILogger;
    /** Session expiration duration in milliseconds (default: 12 hours) */
    sessionExpirationMs?: number;
}

export interface SessionResolveOptions {
    /** Explicit session ID to resume */
    sessionId?: string;
    /** Session name to find or create */
    sessionName?: string;
    /** Agent configuration */
    agentConfig?: Record<string, unknown>;
    /** Teams/Bot conversation ID for session affinity */
    conversationId?: string;
    /** Copilot SDK session ID to store */
    copilotSessionId?: string;
}

export interface SessionStatusResult {
    exists: boolean;
    expired: boolean;
    remainingTimeMs?: number;
    createdAt?: Date;
    lastActivityAt?: Date;
    copilotSessionId?: string;
}

/**
 * Session Manager for managing session lifecycle.
 *
 * This is the UNIFIED session manager that handles:
 * - Creating new sessions with Copilot SDK session IDs
 * - Resuming existing sessions by ID, name, or conversation ID
 * - Updating session details (name, status, copilot session ID)
 * - Session expiration checking
 *
 * All session state is persisted via the injected ISessionStore, enabling stateless deployments.
 */
export class SessionManager {
    private db: ISessionStore;
    private initialized = false;
    private log: ILogger;
    private sessionExpirationMs: number;

    constructor(options: SessionManagerOptions) {
        this.db = options.store;
        this.log = options.logger ?? getLogger('session');
        this.sessionExpirationMs = options.sessionExpirationMs ?? SESSION_EXPIRATION_MS;
    }

    /**
     * Initialize the session manager and underlying store connection.
     */
    async initialize(): Promise<void> {
        if (!this.initialized) {
            await this.db.initialize();
            this.initialized = true;
            this.log.info('Initialized.');
        }
    }

    /**
     * Check session status without modifying it.
     * Used for checking expiration before processing a request.
     */
    async getSessionStatus(username: string, conversationId: string): Promise<SessionStatusResult> {
        await this.initialize();

        const session = await this.db.getSessionByConversationId(username, conversationId);

        if (!session) {
            return { exists: false, expired: false };
        }

        const now = new Date();
        const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
        const expired = expiresAt ? now >= expiresAt : false;
        const remainingTimeMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : undefined;

        return {
            exists: true,
            expired,
            remainingTimeMs,
            createdAt: new Date(session.start_time),
            lastActivityAt: session.last_activity_at ? new Date(session.last_activity_at) : undefined,
            copilotSessionId: session.copilot_session_id
        };
    }

    /**
     * Resolve a session with full support for stateless operation.
     *
     * Resolution priority:
     * 1. sessionId provided -> Look up by ID (must exist)
     * 2. conversationId provided -> Look up active session for conversation
     * 3. sessionName provided -> Look up by name or create new
     * 4. None provided -> Create new unnamed session
     *
     * @param userInfo User information (username, hostname)
     * @param options Session resolution options including conversationId
     * @returns SessionResolveResult containing the session and whether it's new
     */
    async resolveSession(
        userInfo: UserInfo,
        options?: SessionResolveOptions
    ): Promise<SessionResolveResult> {
        await this.initialize();

        const { sessionId, sessionName, agentConfig, conversationId, copilotSessionId } = options ?? {};

        // Case 1: sessionId provided - must exist
        if (sessionId) {
            const session = await this.db.getSession(sessionId, userInfo.username);
            if (!session) {
                throw new SessionNotFoundError(
                    `Session with ID '${sessionId}' not found for user '${userInfo.username}'`
                );
            }

            // Check if expired
            if (this.isSessionExpired(session)) {
                throw new SessionExpiredError(
                    `Session '${sessionId}' has expired. Use /resume to start a new session.`
                );
            }

            this.log.info('Resumed session by ID: %s', sessionId);
            return { session, isNew: false };
        }

        // Case 2: conversationId provided - look up active session for this conversation
        if (conversationId) {
            const existingSession = await this.db.getSessionByConversationId(userInfo.username, conversationId);
            if (existingSession && !this.isSessionExpired(existingSession)) {
                this.log.info('Resumed session by conversationId: %s, sessionId: %s', conversationId, existingSession.id);
                return { session: existingSession, isNew: false };
            }

            // No active session for this conversation, create new
            const newSession = createSessionInfo(userInfo, {
                name: sessionName,
                agentConfig,
                conversationId,
                copilotSessionId,
                expirationMs: this.sessionExpirationMs
            });
            const createdSession = await this.db.createSession(newSession);
            this.log.info('Created new session for conversation: %s, sessionId: %s', conversationId, createdSession.id);
            return { session: createdSession, isNew: true };
        }

        // Case 3: sessionName provided - resume or create
        if (sessionName) {
            const existingSession = await this.db.getSessionByName(userInfo.username, sessionName);
            if (existingSession && !this.isSessionExpired(existingSession)) {
                this.log.info('Resumed session by name: %s', sessionName);
                return { session: existingSession, isNew: false };
            }

            // Create new session with the provided name
            const newSession = createSessionInfo(userInfo, { name: sessionName, agentConfig, copilotSessionId, expirationMs: this.sessionExpirationMs });
            const createdSession = await this.db.createSession(newSession);
            this.log.info('Created new session with name: %s', sessionName);
            return { session: createdSession, isNew: true };
        }

        // Case 4: Neither provided - create new unnamed session
        const newSession = createSessionInfo(userInfo, { agentConfig, copilotSessionId, expirationMs: this.sessionExpirationMs });
        const createdSession = await this.db.createSession(newSession);
        this.log.info('Created new unnamed session: %s', createdSession.id);
        return { session: createdSession, isNew: true };
    }

    /**
     * Check if a session is expired.
     */
    private isSessionExpired(session: SessionInfo): boolean {
        if (!session.expires_at) return false;
        return new Date() >= new Date(session.expires_at);
    }

    /**
     * Get session information by ID.
     */
    async getSession(username: string, sessionId: string): Promise<SessionInfo | null> {
        await this.initialize();
        return this.db.getSession(sessionId, username);
    }

    /**
     * Get session by conversation ID.
     */
    async getSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null> {
        await this.initialize();
        return this.db.getSessionByConversationId(username, conversationId);
    }

    /**
     * Get all sessions for a user.
     */
    async getUserSessions(username: string): Promise<SessionInfo[]> {
        await this.initialize();
        return this.db.getSessionsByUser(username);
    }

    /**
     * Update session with Copilot SDK session ID.
     * Called after successfully creating a Copilot session to enable stateless resume.
     */
    async updateCopilotSessionId(
        username: string,
        sessionId: string,
        copilotSessionId: string
    ): Promise<SessionInfo> {
        await this.initialize();

        const session = await this.db.getSession(sessionId, username);
        if (!session) {
            throw new SessionNotFoundError(
                `Session with ID '${sessionId}' not found for user '${username}'`
            );
        }

        session.copilot_session_id = copilotSessionId;
        session.last_activity_at = new Date().toISOString();

        const updatedSession = await this.db.updateSession(
            sessionId,
            getSessionPartitionKey(session),
            session
        );

        this.log.info('Updated copilot_session_id for session %s', sessionId);
        return updatedSession;
    }

    /**
     * Touch session to update last activity timestamp.
     */
    async touchSession(username: string, sessionId: string): Promise<SessionInfo | null> {
        await this.initialize();

        const session = await this.db.getSession(sessionId, username);
        if (!session) {
            return null;
        }

        if (this.isSessionExpired(session)) {
            return null;
        }

        session.last_activity_at = new Date().toISOString();

        return this.db.updateSession(
            sessionId,
            getSessionPartitionKey(session),
            session
        );
    }

    /**
     * Update session name.
     *
     * @param username The username (partition key)
     * @param sessionId The session ID
     * @param newName The new session name
     * @throws SessionNotFoundError if session doesn't exist
     * @throws SessionNameConflictError if name already exists for this user
     */
    async renameSession(
        username: string,
        sessionId: string,
        newName: string
    ): Promise<SessionInfo> {
        await this.initialize();

        // Get existing session
        const session = await this.db.getSession(sessionId, username);
        if (!session) {
            throw new SessionNotFoundError(
                `Session with ID '${sessionId}' not found for user '${username}'`
            );
        }

        // Check if name is already taken
        if (newName) {
            const existingWithName = await this.db.getSessionByName(username, newName);
            if (existingWithName && existingWithName.id !== sessionId) {
                throw new SessionNameConflictError(
                    `Session name '${newName}' already exists for user '${username}'`
                );
            }
        }

        // Update session
        session.name = newName;
        const updatedSession = await this.db.updateSession(
            sessionId,
            getSessionPartitionKey(session),
            session
        );

        this.log.info('Renamed session %s to \'%s\'', sessionId, newName);
        return updatedSession;
    }

    /**
     * End a session with a final status.
     * Also clears the Copilot session ID as the session is no longer resumable.
     */
    async endSession(
        username: string,
        sessionId: string,
        status: SessionStatus = SessionStatus.COMPLETED
    ): Promise<SessionInfo> {
        await this.initialize();

        const session = await this.db.getSession(sessionId, username);
        if (!session) {
            throw new SessionNotFoundError(
                `Session with ID '${sessionId}' not found for user '${username}'`
            );
        }

        session.end_time = new Date().toISOString();
        session.status = status;
        session.copilot_session_id = undefined; // Clear copilot session ID

        const updatedSession = await this.db.updateSession(
            sessionId,
            getSessionPartitionKey(session),
            session
        );

        this.log.info('Ended session %s with status: %s', sessionId, status);
        return updatedSession;
    }

    /**
     * End a session by conversation ID.
     */
    async endSessionByConversationId(
        username: string,
        conversationId: string,
        status: SessionStatus = SessionStatus.COMPLETED
    ): Promise<SessionInfo | null> {
        await this.initialize();

        const session = await this.db.getSessionByConversationId(username, conversationId);
        if (!session) {
            return null;
        }

        return this.endSession(username, session.id, status);
    }

    /**
     * Reactivate the most recent session for a conversation.
     * Finds the last session regardless of status, sets it back to active,
     * and extends the expiry by the configured session duration.
     *
     * @returns The reactivated session, or null if no session found.
     */
    async reactivateSession(
        username: string,
        conversationId: string
    ): Promise<SessionInfo | null> {
        await this.initialize();

        const lastSession = await this.db.getLastSessionByConversationId(username, conversationId);
        if (!lastSession) {
            this.log.warn('reactivateSession: no session found for conversation %s', conversationId);
            return null;
        }

        // Reactivate: set status back to active, extend expiry
        lastSession.status = SessionStatus.ACTIVE;
        lastSession.end_time = undefined;
        lastSession.expires_at = new Date(
            Date.now() + this.sessionExpirationMs
        ).toISOString();
        lastSession.last_activity_at = new Date().toISOString();

        const updated = await this.db.updateSession(
            lastSession.id,
            getSessionPartitionKey(lastSession),
            lastSession
        );

        this.log.info(
            'reactivateSession: reactivated session %s, new expiry=%s',
            updated.id,
            updated.expires_at
        );
        return updated;
    }

    // ============ Session Sharing ============

    /**
     * Share a session with another user.
     *
     * @param sessionId The session to share
     * @param ownerUsername The session owner's username (must match)
     * @param sharedWithUsername The recipient's username
     * @param role The access role (viewer or collaborator)
     * @returns The created SessionShare
     * @throws SessionNotFoundError if session doesn't exist
     * @throws Error if caller is not the session owner
     */
    async shareSession(
        sessionId: string,
        ownerUsername: string,
        sharedWithUsername: string,
        role: ShareRole = ShareRole.COLLABORATOR
    ): Promise<SessionShare> {
        await this.initialize();

        const session = await this.db.getSession(sessionId, ownerUsername);
        if (!session) {
            throw new SessionNotFoundError(
                `Session '${sessionId}' not found for user '${ownerUsername}'`
            );
        }

        if (session.user_info.username !== ownerUsername) {
            throw new Error(`User '${ownerUsername}' is not the owner of session '${sessionId}'`);
        }

        const share = createSessionShare(sessionId, ownerUsername, sharedWithUsername, role);
        const created = await this.db.shareSession(share);

        // Mark session as shared
        if (!session.is_shared) {
            session.is_shared = true;
            session.share_id = share.share_id;
            await this.db.updateSession(sessionId, getSessionPartitionKey(session), session);
        }

        this.log.info(
            'shareSession: shared session %s with %s (role=%s, shareId=%s)',
            sessionId, sharedWithUsername, role, share.share_id
        );

        return created;
    }

    /**
     * Get all sessions accessible by a user (own + shared with them).
     */
    async getAccessibleSessions(username: string): Promise<{
        own: SessionInfo[];
        shared: Array<{ share: SessionShare; session: SessionInfo }>;
    }> {
        await this.initialize();

        const own = await this.db.getSessionsByUser(username);
        const shares = await this.db.getSharedSessions(username);

        const shared: Array<{ share: SessionShare; session: SessionInfo }> = [];
        for (const share of shares) {
            const session = await this.db.getSession(share.session_id, share.session_owner);
            if (session) {
                shared.push({ share, session });
            }
        }

        this.log.debug(
            'getAccessibleSessions: found %d own + %d shared sessions for %s',
            own.length, shared.length, username
        );

        return { own, shared };
    }

    /**
     * Check if a user can access a session (as owner or via share).
     *
     * @returns The access role ('owner', the ShareRole, or null if no access)
     */
    async canAccessSession(
        sessionId: string,
        username: string
    ): Promise<'owner' | ShareRole | null> {
        await this.initialize();

        // Check ownership first — try to find the session for this user
        const ownSession = await this.db.getSession(sessionId, username);
        if (ownSession) {
            return 'owner';
        }

        // Check shares
        const shares = await this.db.getSharesForSession(sessionId);
        const userShare = shares.find(s => s.shared_with_username === username);
        if (userShare) {
            return userShare.role;
        }

        this.log.warn('canAccessSession: access denied for user %s on session %s', username, sessionId);
        return null;
    }

    /**
     * Revoke a session share.
     *
     * @param shareId The share_id to revoke
     * @param ownerUsername The session owner's username (only owner can revoke)
     * @returns true if revoked, false if not found
     */
    async revokeShare(shareId: string, ownerUsername: string): Promise<boolean> {
        await this.initialize();

        // Verify the share exists and belongs to this owner
        const session = await this.db.getSessionByShareId(shareId);
        if (!session) {
            return false;
        }

        if (session.user_info.username !== ownerUsername) {
            throw new Error(`User '${ownerUsername}' is not the owner of the shared session`);
        }

        const revoked = await this.db.revokeShare(shareId);
        if (revoked) {
            this.log.info('revokeShare: revoked share %s by owner %s', shareId, ownerUsername);
        }
        return revoked;
    }

    /**
     * Get a session by its share link ID.
     */
    async getSessionByShareId(shareId: string): Promise<SessionInfo | null> {
        await this.initialize();
        return this.db.getSessionByShareId(shareId);
    }
}

// ============ Error Classes ============

export class SessionNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionNotFoundError';
    }
}

export class SessionExpiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionExpiredError';
    }
}

export class SessionNameConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionNameConflictError';
    }
}

// ============ Helper Functions ============

/**
 * Format remaining time as human-readable string.
 */
export function formatRemainingTime(remainingMs: number): string {
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
