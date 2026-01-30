/**
 * Unit tests for AuditManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditManager } from './audit-manager.js';
import { InMemoryAuditStore } from './stores/in-memory-audit-store.js';
import { ToolExecutionStatus } from './models.js';

describe('AuditManager', () => {
    let store: InMemoryAuditStore;
    let audit: AuditManager;

    const SESSION_ID = 'session-test-001';

    beforeEach(() => {
        store = new InMemoryAuditStore();
        audit = new AuditManager({ store });
    });

    describe('start and complete interaction', () => {
        it('should start an interaction and return an ID', async () => {
            audit.setSession(SESSION_ID);

            const interactionId = await audit.startInteraction('Hello, world!');

            expect(interactionId).toBeDefined();
            expect(audit.interactionId).toBe(interactionId);
            expect(store.getCounts().interactions).toBe(1);
        });

        it('should complete an interaction with response', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('What is 2+2?');

            const completed = await audit.completeInteraction('4', 'Simple math');

            expect(completed).not.toBeNull();
            expect(completed!.copilot_response).toBe('4');
            expect(completed!.reasoning).toBe('Simple math');
            expect(completed!.user_query).toBe('What is 2+2?');
            expect(audit.interactionId).toBeNull();
        });

        it('should return null when completing with no active interaction', async () => {
            audit.setSession(SESSION_ID);

            const result = await audit.completeInteraction('response');

            expect(result).toBeNull();
        });
    });

    describe('log tool start and complete', () => {
        it('should log a tool start', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Use a tool');

            const toolId = await audit.logToolStart('search', { query: 'test' });

            expect(toolId).toBeDefined();
            expect(store.getCounts().toolExecutions).toBe(1);
        });

        it('should log tool completion with result', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Use a tool');

            const toolId = await audit.logToolStart('search', { query: 'test' });
            const completed = await audit.logToolComplete(toolId, { results: ['a', 'b'] });

            expect(completed).not.toBeNull();
            expect(completed!.status).toBe(ToolExecutionStatus.COMPLETED);
            expect(completed!.result).toEqual({ results: ['a', 'b'] });
            expect(completed!.end_time).toBeDefined();
            expect(completed!.error_message).toBeUndefined();
        });

        it('should log tool completion with error', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Use a tool');

            const toolId = await audit.logToolStart('search');
            const completed = await audit.logToolComplete(toolId, undefined, 'timeout');

            expect(completed).not.toBeNull();
            expect(completed!.status).toBe(ToolExecutionStatus.ERROR);
            expect(completed!.error_message).toBe('timeout');
        });

        it('should return null for unknown tool ID on complete', async () => {
            audit.setSession(SESSION_ID);

            const result = await audit.logToolComplete('unknown-id', 'result');

            expect(result).toBeNull();
        });

        it('should add tool execution ID to current interaction', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Use tools');

            const toolId1 = await audit.logToolStart('tool1');
            const toolId2 = await audit.logToolStart('tool2');

            const completed = await audit.completeInteraction('done');

            expect(completed!.tool_execution_ids).toContain(toolId1);
            expect(completed!.tool_execution_ids).toContain(toolId2);
        });
    });

    describe('logToolExecution (start + complete)', () => {
        it('should log a full tool execution in one call', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Full tool call');

            const tool = await audit.logToolExecution(
                'calculator',
                { expression: '2+2' },
                4
            );

            expect(tool).not.toBeNull();
            expect(tool!.tool_name).toBe('calculator');
            expect(tool!.arguments).toEqual({ expression: '2+2' });
            expect(tool!.result).toBe(4);
            expect(tool!.status).toBe(ToolExecutionStatus.COMPLETED);
            expect(tool!.end_time).toBeDefined();
        });

        it('should log a full tool execution with error', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Failing tool');

            const tool = await audit.logToolExecution(
                'api_call',
                { url: 'https://example.com' },
                undefined,
                'Network error'
            );

            expect(tool).not.toBeNull();
            expect(tool!.status).toBe(ToolExecutionStatus.ERROR);
            expect(tool!.error_message).toBe('Network error');
        });
    });

    describe('error handling - no session set', () => {
        it('should throw when starting interaction without session', async () => {
            await expect(
                audit.startInteraction('query')
            ).rejects.toThrow('Cannot start interaction without an active session');
        });

        it('should throw when logging tool without session', async () => {
            await expect(
                audit.logToolStart('tool')
            ).rejects.toThrow('Cannot log tool execution without an active session');
        });
    });

    describe('multiple interactions in sequence', () => {
        it('should handle multiple sequential interactions', async () => {
            audit.setSession(SESSION_ID);

            const id1 = await audit.startInteraction('First query');
            await audit.completeInteraction('First response');

            const id2 = await audit.startInteraction('Second query');
            await audit.completeInteraction('Second response');

            expect(id1).not.toBe(id2);
            expect(store.getCounts().interactions).toBe(2);

            const interactions = await audit.getSessionInteractions();
            expect(interactions).toHaveLength(2);
            expect(interactions[0].user_query).toBe('First query');
            expect(interactions[1].user_query).toBe('Second query');
        });
    });

    describe('interrupted interaction handling', () => {
        it('should auto-complete previous interaction when starting new one', async () => {
            audit.setSession(SESSION_ID);

            await audit.startInteraction('First query');
            // Don't explicitly complete; start another
            await audit.startInteraction('Second query');

            const interactions = await audit.getSessionInteractions();
            expect(interactions).toHaveLength(2);

            // First interaction should be auto-completed with interrupted message
            expect(interactions[0].copilot_response).toBe('[Interrupted by new query]');
            // Second should still be active (no response yet)
            expect(interactions[1].copilot_response).toBeUndefined();
        });
    });

    describe('query methods', () => {
        it('getSessionInteractions should return interactions for session', async () => {
            audit.setSession(SESSION_ID);

            await audit.startInteraction('Q1');
            await audit.completeInteraction('A1');
            await audit.startInteraction('Q2');
            await audit.completeInteraction('A2');

            const interactions = await audit.getSessionInteractions();

            expect(interactions).toHaveLength(2);
            expect(interactions[0].user_query).toBe('Q1');
            expect(interactions[1].user_query).toBe('Q2');
        });

        it('getSessionToolExecutions should return tool executions for session', async () => {
            audit.setSession(SESSION_ID);
            await audit.startInteraction('Use tools');

            await audit.logToolExecution('tool1', { a: 1 }, 'result1');
            await audit.logToolExecution('tool2', { b: 2 }, 'result2');

            const tools = await audit.getSessionToolExecutions();

            expect(tools).toHaveLength(2);
            expect(tools[0].tool_name).toBe('tool1');
            expect(tools[1].tool_name).toBe('tool2');
        });

        it('getSessionInteractions should return empty array without session', async () => {
            const interactions = await audit.getSessionInteractions();
            expect(interactions).toEqual([]);
        });

        it('getSessionToolExecutions should return empty array without session', async () => {
            const tools = await audit.getSessionToolExecutions();
            expect(tools).toEqual([]);
        });
    });

    describe('setSession', () => {
        it('should reset state when switching sessions', async () => {
            audit.setSession('session-1');
            await audit.startInteraction('Q in session 1');
            const toolId = await audit.logToolStart('tool');

            // Switch session — should clear current interaction and pending tools
            audit.setSession('session-2');

            expect(audit.sessionId).toBe('session-2');
            expect(audit.interactionId).toBeNull();

            // Old tool should not be completable
            const result = await audit.logToolComplete(toolId, 'result');
            expect(result).toBeNull();
        });
    });
});
