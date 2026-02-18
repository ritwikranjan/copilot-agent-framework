/**
 * Unit tests for Audit Models.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    SessionStatus,
    ToolExecutionStatus,
    createSessionInfo,
    createInteraction,
    createToolExecution,
    getSessionPartitionKey,
    getInteractionPartitionKey,
    getToolExecutionPartitionKey
} from './models.js';
import type { UserInfo, SessionInfo, Interaction, ToolExecution } from './models.js';
import { formatRemainingTime } from './session-manager.js';

describe('Models', () => {
    const mockUserInfo: UserInfo = {
        username: 'testuser@example.com',
        hostname: 'test-host'
    };

    describe('createSessionInfo', () => {
        it('should create a session with default values', () => {
            const session = createSessionInfo(mockUserInfo);
            
            expect(session.id).toBeDefined();
            expect(session.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
            expect(session.user_info).toEqual(mockUserInfo);
            expect(session.start_time).toBeDefined();
            expect(session.status).toBe(SessionStatus.ACTIVE);
            expect(session.name).toBeUndefined();
            expect(session.end_time).toBeUndefined();
            // New fields for stateless session management
            expect(session.expires_at).toBeDefined();
            expect(session.last_activity_at).toBeDefined();
        });

        it('should create a session with a custom name', () => {
            const session = createSessionInfo(mockUserInfo, { name: 'My Session' });
            
            expect(session.name).toBe('My Session');
        });

        it('should create a session with agent config', () => {
            const agentConfig = { model: 'gpt-4', temperature: 0.7 };
            const session = createSessionInfo(mockUserInfo, { agentConfig });
            
            expect(session.agent_config).toEqual(agentConfig);
        });

        it('should create a session with conversationId and copilotSessionId', () => {
            const session = createSessionInfo(mockUserInfo, {
                conversationId: 'conv-123',
                copilotSessionId: 'copilot-session-456'
            });
            
            expect(session.conversation_id).toBe('conv-123');
            expect(session.copilot_session_id).toBe('copilot-session-456');
        });

        it('should set expires_at to 12 hours from creation', () => {
            const before = Date.now();
            const session = createSessionInfo(mockUserInfo);
            const after = Date.now();

            const expiresAt = new Date(session.expires_at!).getTime();
            const expectedMin = before + (12 * 60 * 60 * 1000);
            const expectedMax = after + (12 * 60 * 60 * 1000);

            expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
            expect(expiresAt).toBeLessThanOrEqual(expectedMax);
        });

        it('should use custom expirationMs when provided', () => {
            const customMs = 2 * 60 * 60 * 1000; // 2 hours
            const before = Date.now();
            const session = createSessionInfo(mockUserInfo, { expirationMs: customMs });
            const after = Date.now();

            const expiresAt = new Date(session.expires_at!).getTime();
            expect(expiresAt).toBeGreaterThanOrEqual(before + customMs);
            expect(expiresAt).toBeLessThanOrEqual(after + customMs);
        });

        it('should generate unique IDs for each session', () => {
            const session1 = createSessionInfo(mockUserInfo);
            const session2 = createSessionInfo(mockUserInfo);
            
            expect(session1.id).not.toBe(session2.id);
        });
    });

    describe('createInteraction', () => {
        const sessionId = 'session-123';

        it('should create an interaction with required fields', () => {
            const userQuery = 'What is the weather today?';
            const interaction = createInteraction(sessionId, userQuery);
            
            expect(interaction.id).toBeDefined();
            expect(interaction.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(interaction.session_id).toBe(sessionId);
            expect(interaction.user_query).toBe(userQuery);
            expect(interaction.timestamp).toBeDefined();
            expect(interaction.tool_execution_ids).toEqual([]);
            expect(interaction.copilot_response).toBeUndefined();
            expect(interaction.reasoning).toBeUndefined();
        });

        it('should generate unique IDs for each interaction', () => {
            const interaction1 = createInteraction(sessionId, 'Query 1');
            const interaction2 = createInteraction(sessionId, 'Query 2');
            
            expect(interaction1.id).not.toBe(interaction2.id);
        });
    });

    describe('createToolExecution', () => {
        const sessionId = 'session-456';
        const toolName = 'search_web';

        it('should create a tool execution with required fields', () => {
            const tool = createToolExecution(sessionId, toolName);
            
            expect(tool.id).toBeDefined();
            expect(tool.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(tool.session_id).toBe(sessionId);
            expect(tool.tool_name).toBe(toolName);
            expect(tool.start_time).toBeDefined();
            expect(tool.status).toBe(ToolExecutionStatus.STARTED);
            expect(tool.interaction_id).toBeUndefined();
            expect(tool.arguments).toBeUndefined();
        });

        it('should create a tool execution with interaction ID', () => {
            const interactionId = 'interaction-789';
            const tool = createToolExecution(sessionId, toolName, { interactionId });
            
            expect(tool.interaction_id).toBe(interactionId);
        });

        it('should create a tool execution with arguments', () => {
            const args = { query: 'test query', limit: 10 };
            const tool = createToolExecution(sessionId, toolName, { arguments: args });
            
            expect(tool.arguments).toEqual(args);
        });

        it('should generate unique IDs for each tool execution', () => {
            const tool1 = createToolExecution(sessionId, toolName);
            const tool2 = createToolExecution(sessionId, toolName);
            
            expect(tool1.id).not.toBe(tool2.id);
        });
    });

    describe('Partition Key Functions', () => {
        it('should return username as session partition key', () => {
            const session = createSessionInfo(mockUserInfo);
            
            expect(getSessionPartitionKey(session)).toBe(mockUserInfo.username);
        });

        it('should return session_id as interaction partition key', () => {
            const interaction = createInteraction('session-abc', 'query');
            
            expect(getInteractionPartitionKey(interaction)).toBe('session-abc');
        });

        it('should return session_id as tool execution partition key', () => {
            const tool = createToolExecution('session-xyz', 'tool_name');
            
            expect(getToolExecutionPartitionKey(tool)).toBe('session-xyz');
        });
    });

    describe('SessionStatus enum', () => {
        it('should have expected values', () => {
            expect(SessionStatus.ACTIVE).toBe('active');
            expect(SessionStatus.COMPLETED).toBe('completed');
            expect(SessionStatus.ERROR).toBe('error');
        });
    });

    describe('ToolExecutionStatus enum', () => {
        it('should have expected values', () => {
            expect(ToolExecutionStatus.STARTED).toBe('started');
            expect(ToolExecutionStatus.COMPLETED).toBe('completed');
            expect(ToolExecutionStatus.ERROR).toBe('error');
        });
    });

    describe('formatRemainingTime', () => {
        it('should format hours and minutes', () => {
            const ms = 3 * 60 * 60 * 1000 + 30 * 60 * 1000; // 3h 30m
            expect(formatRemainingTime(ms)).toBe('3h 30m');
        });

        it('should format only minutes when less than 1 hour', () => {
            const ms = 45 * 60 * 1000; // 45m
            expect(formatRemainingTime(ms)).toBe('45m');
        });

        it('should format zero minutes', () => {
            expect(formatRemainingTime(0)).toBe('0m');
        });

        it('should format exact hours with 0 minutes', () => {
            const ms = 2 * 60 * 60 * 1000; // 2h 0m
            expect(formatRemainingTime(ms)).toBe('2h 0m');
        });

        it('should handle large values', () => {
            const ms = 11 * 60 * 60 * 1000 + 59 * 60 * 1000; // 11h 59m
            expect(formatRemainingTime(ms)).toBe('11h 59m');
        });
    });
});
