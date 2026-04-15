/**
 * @ritwikranjan/copilot-agent-framework
 * 
 * Framework-agnostic Copilot SDK wrapper with session management,
 * audit logging, and pluggable persistence.
 */

// ============ Logger ============
export {
    setLogger,
    getLogger,
} from './logger.js';

export type {
    ILogger,
} from './logger.js';

// ============ Models and Types ============
export {
    SessionStatus,
    ToolExecutionStatus,
    SESSION_EXPIRATION_MS,
    createSessionInfo,
    createInteraction,
    createToolExecution,
    getSessionPartitionKey,
    getInteractionPartitionKey,
    getToolExecutionPartitionKey,
} from './models.js';

export type {
    UserInfo,
    SessionInfo,
    Interaction,
    ToolExecution,
    CopilotResponse,
    MCPServerConfigInput,
    ToolsConfig,
    MCPServerConfig,
    IStreamHandler,
    ProcessMessageContext,
    ProcessMessageOptions,
    HandleEventFn,
    AuditContext,
} from './models.js';

// ============ Interfaces ============
export type {
    ISessionStore,
    IAuditStore,
} from './interfaces.js';

// ============ Session Manager ============
export {
    SessionManager,
    SessionNotFoundError,
    SessionExpiredError,
    SessionNameConflictError,
    formatRemainingTime,
} from './session-manager.js';

export type {
    SessionResolveResult,
    SessionManagerOptions,
    SessionResolveOptions,
    SessionStatusResult,
} from './session-manager.js';

// ============ Audit Manager ============
export { AuditManager } from './audit-manager.js';

export type { AuditManagerOptions } from './audit-manager.js';

// ============ Copilot Service ============
export {
    CopilotService,
    defaultStreamingHandler,
    loadSystemPrompt,
    loadToolsConfig,
    buildMcpServersConfig,
} from './copilot-service.js';

export type {
    CopilotServiceConfig,
    SendMessageOptions,
} from './copilot-service.js';

// ============ In-Memory Stores ============
export { InMemorySessionStore } from './stores/in-memory-session-store.js';
export { InMemoryAuditStore } from './stores/in-memory-audit-store.js';
