/**
 * Unit tests for CopilotService.
 *
 * Uses mocked @github/copilot-sdk CopilotClient to test the service
 * layer without requiring a running CLI server.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { CopilotService, loadSystemPrompt, loadToolsConfig, buildMcpServersConfig } from './copilot-service.js';
import { SessionManager } from './session-manager.js';
import { AuditManager } from './audit-manager.js';
import { InMemorySessionStore } from './stores/in-memory-session-store.js';
import { InMemoryAuditStore } from './stores/in-memory-audit-store.js';
import type { UserInfo, IStreamHandler, CopilotServiceConfig } from './index.js';

// ============ Mock @github/copilot-sdk ============

const mockSendAndWait = vi.fn();
const mockSend = vi.fn();
const mockOn = vi.fn();
const mockResumeSession = vi.fn();
const mockCreateSession = vi.fn();
const mockStop = vi.fn();

vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn().mockImplementation(() => ({
        createSession: mockCreateSession,
        resumeSession: mockResumeSession,
        stop: mockStop,
    })),
}));

// ============ Helpers ============

/** Silent logger for tests — suppresses all output */
const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

function createService(overrides?: Partial<CopilotServiceConfig>, enableAudit = true) {
    const sessionStore = new InMemorySessionStore();
    const auditStore = new InMemoryAuditStore();
    const sessionManager = new SessionManager({ store: sessionStore, logger: silentLogger });
    const auditManager = enableAudit ? new AuditManager({ store: auditStore, logger: silentLogger }) : undefined;

    const config: CopilotServiceConfig = {
        cliUrl: 'localhost:3000',
        model: 'test-model',
        agentName: 'test-agent',
        systemPrompt: 'You are a test assistant.',
        enableAudit,
        logger: silentLogger,
        ...overrides,
    };

    const service = new CopilotService(config, sessionManager, auditManager);

    return { service, sessionManager, auditManager, sessionStore, auditStore };
}

const userInfo: UserInfo = {
    username: 'test-user',
    hostname: 'test-host',
};

// ============ Tests ============

describe('CopilotService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: createSession returns a mock session with sendAndWait/send/on
        mockCreateSession.mockResolvedValue({
            sessionId: 'copilot-session-123',
            sendAndWait: mockSendAndWait,
            send: mockSend,
            on: mockOn,
        });
        mockStop.mockResolvedValue(undefined);
    });

    describe('constructor and getConfig', () => {
        it('should initialize with config and return it', () => {
            const { service } = createService();

            const config = service.getConfig();

            expect(config.cliUrl).toBe('localhost:3000');
            expect(config.model).toBe('test-model');
            expect(config.agentName).toBe('test-agent');
            expect(config.auditEnabled).toBe(true);
            expect(config.hasMcpServers).toBe(false);
        });

        it('should report MCP servers when configured', () => {
            const { service } = createService({
                mcpServers: [{ name: 'test-mcp', command: 'node', args: ['mcp.js'] }],
            });

            expect(service.getConfig().hasMcpServers).toBe(true);
        });
    });

    describe('sendMessage (synchronous)', () => {
        it('should send a message and return the response', async () => {
            mockSendAndWait.mockResolvedValue({
                data: { content: 'Hello from Copilot!' },
            });

            const { service } = createService();
            const response = await service.sendMessage('Hello', userInfo);

            expect(response.success).toBe(true);
            expect(response.response).toBe('Hello from Copilot!');
            expect(response.model).toBe('test-model');
            expect(response.agent).toBe('test-agent');
        });

        it('should extract content from response.message fallback', async () => {
            mockSendAndWait.mockResolvedValue({
                data: { message: 'Fallback message' },
            });

            const { service } = createService();
            const response = await service.sendMessage('Hi', userInfo);

            expect(response.response).toBe('Fallback message');
        });

        it('should handle string data response', async () => {
            mockSendAndWait.mockResolvedValue({
                data: 'Raw string response',
            });

            const { service } = createService();
            const response = await service.sendMessage('Hi', userInfo);

            expect(response.response).toBe('Raw string response');
        });

        it('should return error on CopilotClient failure', async () => {
            mockCreateSession.mockRejectedValue(new Error('Connection refused'));

            const { service } = createService();
            const response = await service.sendMessage('Hello', userInfo);

            expect(response.success).toBe(false);
            expect(response.error).toBe('Connection refused');
        });

        it('should call stop on the client after request', async () => {
            mockSendAndWait.mockResolvedValue({ data: { content: 'ok' } });

            const { service } = createService();
            await service.sendMessage('Hello', userInfo);

            expect(mockStop).toHaveBeenCalled();
        });

        it('should log interaction to audit when enabled', async () => {
            mockSendAndWait.mockResolvedValue({ data: { content: 'Response' } });

            const { service, auditStore } = createService();
            await service.sendMessage('What is 2+2?', userInfo);

            expect(auditStore.getCounts().interactions).toBe(1);
        });

        it('should skip audit when disabled', async () => {
            mockSendAndWait.mockResolvedValue({ data: { content: 'Response' } });

            const { service, auditStore } = createService({ enableAudit: false }, false);
            await service.sendMessage('What is 2+2?', userInfo);

            expect(auditStore.getCounts().interactions).toBe(0);
        });
    });

    describe('sendMessageStreaming', () => {
        let emittedContent: string[];
        let streamHandler: IStreamHandler;

        beforeEach(() => {
            emittedContent = [];
            streamHandler = {
                emit: (content: string) => emittedContent.push(content),
                update: vi.fn(),
            };
        });

        it('should stream content via IStreamHandler', async () => {
            // Simulate streaming events
            mockOn.mockImplementation((callback: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                // Emit events in sequence
                setTimeout(() => {
                    callback({ type: 'assistant.turn_start' });
                    callback({ type: 'assistant.message_delta', data: { deltaContent: 'Hello ' } });
                    callback({ type: 'assistant.message_delta', data: { deltaContent: 'World!' } });
                    callback({ type: 'assistant.turn_end' });
                    callback({ type: 'session.idle' });
                }, 0);
                return () => {}; // unsubscribe
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();
            const response = await service.sendMessageStreaming(
                'Hello',
                userInfo,
                streamHandler,
                { conversationId: 'conv-stream-1' }
            );

            expect(response.success).toBe(true);
            expect(emittedContent).toContain('Hello ');
            expect(emittedContent).toContain('World!');
            expect(response.response).toContain('Hello World!');
        });

        it('should handle session.error events', async () => {
            mockOn.mockImplementation((callback: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                setTimeout(() => {
                    callback({ type: 'session.error', data: { message: 'Rate limited' } });
                }, 0);
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();
            const response = await service.sendMessageStreaming(
                'Hello',
                userInfo,
                streamHandler,
                { conversationId: 'conv-error-1' }
            );

            expect(response.success).toBe(false);
            expect(response.error).toBe('Rate limited');
        });

        it('should resume existing session by conversationId', async () => {
            mockOn.mockImplementation((callback: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                setTimeout(() => {
                    callback({ type: 'assistant.message_delta', data: { deltaContent: 'reply' } });
                    callback({ type: 'session.idle' });
                }, 0);
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();

            // First message creates session
            await service.sendMessageStreaming('first', userInfo, streamHandler, { conversationId: 'conv-resume' });
            // Second message should resume
            const response = await service.sendMessageStreaming('second', userInfo, streamHandler, { conversationId: 'conv-resume' });

            expect(response.success).toBe(true);
            // Should have attempted resume on second call (createSession called for storing ID)
            expect(mockCreateSession.mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        it('should handle tool events and emit tool messages', async () => {
            mockOn.mockImplementation((callback: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                setTimeout(() => {
                    callback({
                        type: 'tool.execution_start',
                        data: { toolCallId: 'tc-1', toolName: 'search', arguments: { query: 'test' } }
                    });
                    callback({
                        type: 'tool.execution_complete',
                        data: { toolCallId: 'tc-1', success: true, result: 'found' }
                    });
                    callback({ type: 'assistant.message_delta', data: { deltaContent: 'Result: found' } });
                    callback({ type: 'session.idle' });
                }, 0);
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();
            const response = await service.sendMessageStreaming(
                'search for something',
                userInfo,
                streamHandler,
                { conversationId: 'conv-tools' }
            );

            expect(response.success).toBe(true);
            // Should have emitted tool message
            const toolEmissions = emittedContent.filter(c => c.includes('Using tool'));
            expect(toolEmissions.length).toBe(1);
            expect(toolEmissions[0]).toContain('search');
        });

        it('should handle reasoning events', async () => {
            mockOn.mockImplementation((callback: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                setTimeout(() => {
                    callback({ type: 'assistant.reasoning_delta', data: { deltaContent: 'Thinking...' } });
                    callback({ type: 'assistant.message_delta', data: { deltaContent: 'Answer' } });
                    callback({ type: 'session.idle' });
                }, 0);
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();
            const response = await service.sendMessageStreaming(
                'complex question',
                userInfo,
                streamHandler,
                { conversationId: 'conv-reason', showReasoning: true }
            );

            expect(response.success).toBe(true);
            expect(response.reasoning).toBe('Thinking...');
            expect(streamHandler.update).toHaveBeenCalledWith('Thinking: Thinking...');
        });

        it('should detect and report expired sessions', async () => {
            const { service, sessionManager } = createService();

            // Mock getSessionStatus to return an expired session
            vi.spyOn(sessionManager, 'getSessionStatus').mockResolvedValue({
                exists: true,
                expired: true,
                remainingTimeMs: 0,
                createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
                lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
            });
            vi.spyOn(sessionManager, 'endSessionByConversationId').mockResolvedValue(null);

            const response = await service.sendMessageStreaming(
                'still here?',
                userInfo,
                streamHandler,
                { conversationId: 'conv-expire' }
            );

            expect(response.success).toBe(false);
            expect(response.sessionExpired).toBe(true);
            expect(response.error).toContain('expired');
        });
    });

    describe('session management methods', () => {
        it('getConversationSessionStatus should return status', async () => {
            mockOn.mockImplementation((cb: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                queueMicrotask(() => cb({ type: 'session.idle' }));
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();

            // No session yet
            const status1 = await service.getConversationSessionStatus('conv-status', 'test-user');
            expect(status1.exists).toBe(false);

            // Create a session via streaming
            await service.sendMessageStreaming('hi', userInfo, { emit: () => {} }, { conversationId: 'conv-status' });

            const status2 = await service.getConversationSessionStatus('conv-status', 'test-user');
            expect(status2.exists).toBe(true);
            expect(status2.expired).toBe(false);
        });

        it('endConversationSession should end the session', async () => {
            mockOn.mockImplementation((cb: (event: { type: string; data?: Record<string, unknown> }) => void) => {
                queueMicrotask(() => cb({ type: 'session.idle' }));
                return () => {};
            });
            mockSend.mockResolvedValue(undefined);

            const { service } = createService();

            await service.sendMessageStreaming('hi', userInfo, { emit: () => {} }, { conversationId: 'conv-end' });

            const ended = await service.endConversationSession('conv-end', 'test-user');
            expect(ended).toBe(true);

            const status = await service.getConversationSessionStatus('conv-end', 'test-user');
            expect(status.exists).toBe(false);
        });

        it('resumeConversationSession should create a new session', async () => {
            const { service } = createService();

            const session = await service.resumeConversationSession('conv-resume-2', userInfo);
            expect(session).not.toBeNull();
            expect(session!.conversation_id).toBe('conv-resume-2');
        });
    });
});

// ============ Utility Function Tests ============

describe('loadSystemPrompt', () => {
    beforeEach(() => {
        // Clean env
        delete process.env.SYSTEM_PROMPT;
        delete process.env.SYSTEM_PROMPT_PATH;
    });

    it('should return from env var when set', () => {
        process.env.SYSTEM_PROMPT = 'Custom prompt from env';

        const prompt = loadSystemPrompt();

        expect(prompt).toBe('Custom prompt from env');
    });

    it('should return default when nothing is configured', () => {
        const prompt = loadSystemPrompt({ filePaths: ['/nonexistent/path.md'] });

        expect(prompt).toBe('You are a helpful AI assistant.');
    });

    it('should use custom env var name', () => {
        process.env.MY_PROMPT = 'My custom prompt';

        const prompt = loadSystemPrompt({ envVar: 'MY_PROMPT' });

        expect(prompt).toBe('My custom prompt');

        delete process.env.MY_PROMPT;
    });
});

describe('buildMcpServersConfig', () => {
    it('should return undefined for null config', () => {
        expect(buildMcpServersConfig(null)).toBeUndefined();
    });

    it('should return undefined for empty mcp_servers', () => {
        expect(buildMcpServersConfig({ mcp_servers: {} })).toBeUndefined();
    });

    it('should convert MCP config to array format', () => {
        const result = buildMcpServersConfig({
            mcp_servers: {
                'my-server': {
                    command: 'node',
                    args: ['server.js'],
                    env: { API_KEY: 'test' },
                    tools: ['tool1'],
                }
            }
        });

        expect(result).toHaveLength(1);
        expect(result![0].name).toBe('my-server');
        expect(result![0].command).toBe('node');
        expect(result![0].args).toEqual(['server.js']);
        expect(result![0].env?.API_KEY).toBe('test');
        expect(result![0].tools).toEqual(['tool1']);
    });

    it('should inject extra env vars', () => {
        const result = buildMcpServersConfig(
            {
                mcp_servers: {
                    'server': { command: 'node' }
                }
            },
            { CUSTOM_VAR: 'value' }
        );

        expect(result![0].env?.CUSTOM_VAR).toBe('value');
    });

    it('should default tools to ["*"] when not specified', () => {
        const result = buildMcpServersConfig({
            mcp_servers: {
                'server': { command: 'node' }
            }
        });

        expect(result![0].tools).toEqual(['*']);
    });
});
