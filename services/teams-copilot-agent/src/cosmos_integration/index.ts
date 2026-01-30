/**
 * Audit System for Teams Copilot Agent.
 * 
 * This module provides auditing capabilities for AI agent sessions,
 * including session tracking, interaction logging, and tool execution monitoring.
 * 
 * Re-exports types and classes from @copilot-cli-server/stateless-copilot-sdk,
 * plus local Cosmos DB and mock implementations.
 */

// Models and Types (from library)
export {
    SessionStatus,
    ToolExecutionStatus,
    type UserInfo,
    type SessionInfo,
    type Interaction,
    type ToolExecution,
    createSessionInfo,
    createInteraction,
    createToolExecution,
    getSessionPartitionKey,
    getInteractionPartitionKey,
    getToolExecutionPartitionKey
} from '@copilot-cli-server/stateless-copilot-sdk';

// Interfaces (from library)
export type { ISessionStore, IAuditStore } from '@copilot-cli-server/stateless-copilot-sdk';

// Session Manager (from library)
export {
    SessionManager,
    SessionNotFoundError,
    SessionExpiredError,
    SessionNameConflictError,
    formatRemainingTime
} from '@copilot-cli-server/stateless-copilot-sdk';

export type {
    SessionResolveResult,
    SessionResolveOptions,
    SessionStatusResult,
    SessionManagerOptions
} from '@copilot-cli-server/stateless-copilot-sdk';

// Audit Manager (from library)
export { AuditManager } from '@copilot-cli-server/stateless-copilot-sdk';
export type { AuditManagerOptions } from '@copilot-cli-server/stateless-copilot-sdk';

// Cosmos DB Stores (local implementations)
export {
    SessionCosmosStore,
    AuditCosmosStore,
    getSessionCosmosStore,
    getAuditCosmosStore,
} from './db.js';

// Mock Data Store (for testing)
export { MockDataStore } from './mock-data-store.js';

// ============ Singleton Factories ============
// Uses Cosmos DB in production, in-memory stores for local development.

import {
    SessionManager,
    AuditManager,
    InMemorySessionStore,
    InMemoryAuditStore,
} from '@copilot-cli-server/stateless-copilot-sdk';
import { getSessionCosmosStore, getAuditCosmosStore } from './db.js';

const USE_COSMOS = !!(process.env.COSMOS_ENDPOINT || process.env.COSMOS_ACCOUNT_NAME);

let _sessionManager: SessionManager | null = null;

/**
 * Get the shared SessionManager instance.
 * Uses Cosmos DB when COSMOS_ENDPOINT is set, otherwise falls back to in-memory.
 */
export function getSessionManager(): SessionManager {
    if (!_sessionManager) {
        if (USE_COSMOS) {
            _sessionManager = new SessionManager({ store: getSessionCosmosStore() });
            console.log('[SessionManager] Using Cosmos DB store');
        } else {
            _sessionManager = new SessionManager({ store: new InMemorySessionStore() });
            console.log('[SessionManager] Using in-memory store (local dev)');
        }
    }
    return _sessionManager;
}

let _auditManager: AuditManager | null = null;

/**
 * Get the shared AuditManager instance.
 * Uses Cosmos DB when COSMOS_ENDPOINT is set, otherwise falls back to in-memory.
 */
export function getAuditManager(): AuditManager {
    if (!_auditManager) {
        if (USE_COSMOS) {
            _auditManager = new AuditManager({ store: getAuditCosmosStore() });
            console.log('[AuditManager] Using Cosmos DB store');
        } else {
            _auditManager = new AuditManager({ store: new InMemoryAuditStore() });
            console.log('[AuditManager] Using in-memory store (local dev)');
        }
    }
    return _auditManager;
}