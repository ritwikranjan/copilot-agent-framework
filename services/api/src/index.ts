/**
 * Copilot API Service — Internal HTTP service.
 *
 * Owns all copilot interaction, session management, and audit logging.
 * No authentication — trusts VNet callers. Receives UserInfo from
 * authenticated edge services (Teams bot, Web app).
 */

// Telemetry MUST be imported first
import './telemetry.js';

import express from 'express';
import {
    CopilotService,
    SessionManager,
    AuditManager,
    InMemorySessionStore,
    InMemoryAuditStore,
    loadSystemPrompt,
    loadToolsConfig,
    buildMcpServersConfig,
} from '@ritwikranjan/copilot-agent-framework';
import type { ISessionStore, IAuditStore } from '@ritwikranjan/copilot-agent-framework';
import { SessionCosmosStore, AuditCosmosStore } from './cosmos-stores.js';
import { createChatRouter } from './routes/chat.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createSharingRouter } from './routes/sharing.js';
import { trackRequest } from './telemetry.js';

// ============ Configuration ============

const PORT = parseInt(process.env.PORT || '4000');
const CLI_URL = process.env.CLI_URL || 'localhost:3000';
const MODEL = process.env.MODEL || 'gpt-5.2';
const AGENT_NAME = process.env.AGENT_NAME || 'copilot-api';
const ENABLE_AUDIT = process.env.ENABLE_AUDIT !== 'false';
const USE_COSMOS = !!(process.env.COSMOS_ENDPOINT || process.env.COSMOS_ACCOUNT_NAME);

// ============ Service Initialization ============

let _service: CopilotService | null = null;
let _sessionManager: SessionManager | null = null;
let _auditManager: AuditManager | null = null;
let _auditStore: IAuditStore | null = null;

function initializeServices(): void {
    const systemPrompt = loadSystemPrompt();
    const toolsConfig = loadToolsConfig();
    const mcpServers = buildMcpServersConfig(toolsConfig);

    // Use Cosmos DB in production, in-memory stores for local development
    let sessionStore: ISessionStore;
    let auditStore: IAuditStore;

    if (USE_COSMOS) {
        console.log('[Init] Using Cosmos DB stores');
        sessionStore = new SessionCosmosStore();
        auditStore = new AuditCosmosStore();
    } else {
        console.log('[Init] Using in-memory stores (local development)');
        sessionStore = new InMemorySessionStore();
        auditStore = new InMemoryAuditStore();
    }

    _sessionManager = new SessionManager({ store: sessionStore });
    _auditStore = ENABLE_AUDIT ? auditStore : null;
    _auditManager = ENABLE_AUDIT ? new AuditManager({ store: auditStore }) : null;

    _service = new CopilotService(
        {
            cliUrl: CLI_URL,
            model: MODEL,
            agentName: AGENT_NAME,
            systemPrompt,
            mcpServers,
            enableAudit: ENABLE_AUDIT,
        },
        _sessionManager,
        _auditManager ?? undefined,
    );
}

function getService(): CopilotService {
    if (!_service) throw new Error('Service not initialized');
    return _service;
}
function getSessionManager(): SessionManager {
    if (!_sessionManager) throw new Error('SessionManager not initialized');
    return _sessionManager;
}
function getAuditManager(): AuditManager | null {
    return _auditManager;
}
function getAuditStore(): IAuditStore | null {
    return _auditStore;
}

// ============ Express App ============

const app = express();
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const latency = Date.now() - start;
        trackRequest(req.method, req.path, res.statusCode);
        console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} (${latency}ms)`);
    });
    next();
});

// Health check — no auth
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'copilot-api-service',
    });
});

// Service config
app.get('/api/config', (_req, res) => {
    res.json(getService().getConfig());
});

// Mount route modules
app.use('/api/chat', createChatRouter(getService));
app.use('/api/sessions', createSessionsRouter(getSessionManager, getAuditStore));
app.use('/api/sessions', createSharingRouter(getSessionManager));

// ============ Start ============

async function main(): Promise<void> {
    initializeServices();

    const config = getService().getConfig();

    app.listen(PORT, () => {
        console.log('========================================');
        console.log('Copilot API Service (Internal)');
        console.log('========================================');
        console.log(`Port: ${PORT}`);
        console.log(`CLI URL: ${config.cliUrl}`);
        console.log(`Model: ${config.model}`);
        console.log(`Agent: ${config.agentName}`);
        console.log(`MCP Tools: ${config.hasMcpServers ? 'enabled' : 'disabled'}`);
        console.log(`Audit: ${config.auditEnabled ? 'enabled' : 'disabled'}`);
        console.log('========================================');
    });
}

main().catch(error => {
    console.error('Failed to start API service:', error);
    process.exit(1);
});

// Export for testing
export { app, initializeServices };
