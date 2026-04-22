/**
 * Unit tests for SSE-to-Teams adapter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock telemetry
vi.mock('./telemetry.js', () => ({
    trackThrottle: vi.fn(),
}));

import { pipeSSEToTeams } from './sse-to-teams.js';

function createMockStream() {
    return {
        emit: vi.fn(),
        update: vi.fn(),
    };
}

function createSSEResponse(events: Array<{ type: string; content?: string }>): Response {
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

describe('pipeSSEToTeams', () => {
    let stream: ReturnType<typeof createMockStream>;
    let sent: Array<string | { type: string }>;
    let send: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        stream = createMockStream();
        sent = [];
        send = vi.fn(async (content: string | { type: string }) => {
            sent.push(content);
        });
    });

    it('should pipe message events via send()', async () => {
        const response = createSSEResponse([
            { type: 'message', content: 'Hello World' },
            { type: 'done' },
        ]);

        const result = await pipeSSEToTeams(response, stream as any, send);

        expect(result.success).toBe(true);
        expect(sent).toContainEqual('Hello World');
    });

    it('should pipe typing events via send({ type: typing })', async () => {
        const response = createSSEResponse([
            { type: 'typing' },
            { type: 'done' },
        ]);

        await pipeSSEToTeams(response, stream as any, send);

        expect(send).toHaveBeenCalledWith({ type: 'typing' });
    });

    it('should pipe status events via stream.update()', async () => {
        const response = createSSEResponse([
            { type: 'status', content: '🔧 Using tool: search' },
            { type: 'done' },
        ]);

        await pipeSSEToTeams(response, stream as any, send);

        // Due to throttling, the update may be queued but should eventually be called
        // Since the test runs fast, it should flush immediately
        expect(stream.update).toHaveBeenCalledWith('🔧 Using tool: search');
    });

    it('should emit summary on done with tools used', async () => {
        const response = createSSEResponse([
            { type: 'status', content: '🔧 Using tool: web-search' },
            { type: 'status', content: '🔧 Using tool: calculator' },
            { type: 'message', content: 'Result' },
            { type: 'done' },
        ]);

        await pipeSSEToTeams(response, stream as any, send);

        expect(stream.emit).toHaveBeenCalledWith(
            expect.stringContaining('web-search')
        );
    });

    it('should return error on session error event', async () => {
        const response = createSSEResponse([
            { type: 'error', content: 'Session expired' },
            { type: 'done' },
        ]);

        const result = await pipeSSEToTeams(response, stream as any, send);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Session expired');
    });

    it('should handle empty response body', async () => {
        const response = new Response(null, { status: 200 });

        const result = await pipeSSEToTeams(response, stream as any, send);

        expect(result.success).toBe(false);
        expect(result.error).toBe('No response body');
    });
});
