/**
 * Unit tests for SSE Stream Handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSSEStreamHandler, initSSEResponse } from './sse-stream-handler.js';
import type { Response } from 'express';

function createMockResponse(): Response & { written: string[]; ended: boolean; headers: Record<string, string> } {
    const mock = {
        written: [] as string[],
        ended: false,
        headers: {} as Record<string, string>,
        write: vi.fn((data: string) => { mock.written.push(data); return true; }),
        end: vi.fn(() => { mock.ended = true; }),
        writeHead: vi.fn((_status: number, headers: Record<string, string>) => {
            Object.assign(mock.headers, headers);
        }),
    };
    return mock as unknown as Response & { written: string[]; ended: boolean; headers: Record<string, string> };
}

function parseSSEEvent(raw: string): { type: string; content?: string } {
    const match = raw.match(/^data: (.+)\n\n$/);
    if (!match) throw new Error(`Invalid SSE format: ${raw}`);
    return JSON.parse(match[1]);
}

describe('createSSEStreamHandler', () => {
    let res: ReturnType<typeof createMockResponse>;

    beforeEach(() => {
        res = createMockResponse();
    });

    it('emit() should write delta SSE event', () => {
        const handler = createSSEStreamHandler(res);
        handler.emit('Hello');

        expect(res.written).toHaveLength(1);
        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('delta');
        expect(event.content).toBe('Hello');
    });

    it('update() should write status SSE event', () => {
        const handler = createSSEStreamHandler(res);
        handler.update!('🔧 Using tool: search');

        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('status');
        expect(event.content).toBe('🔧 Using tool: search');
    });

    it('update() with reasoning prefix should write reasoning SSE event', () => {
        const handler = createSSEStreamHandler(res);
        handler.update!('reasoning:Let me think about this...');

        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('reasoning');
        expect(event.content).toBe('Let me think about this...');
    });

    it('sendMessage() should write message SSE event', async () => {
        const handler = createSSEStreamHandler(res);
        await handler.sendMessage!('Full response content');

        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('message');
        expect(event.content).toBe('Full response content');
    });

    it('typing() should write typing SSE event', () => {
        const handler = createSSEStreamHandler(res);
        handler.typing!();

        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('typing');
    });

    it('close() should write done event and end response', () => {
        const handler = createSSEStreamHandler(res);
        handler.close!();

        const event = parseSSEEvent(res.written[0]);
        expect(event.type).toBe('done');
        expect(res.ended).toBe(true);
    });

    it('multiple events should produce valid SSE stream', async () => {
        const handler = createSSEStreamHandler(res);
        handler.typing!();
        handler.update!('Processing...');
        handler.emit('Chunk 1');
        handler.emit('Chunk 2');
        await handler.sendMessage!('Complete message');
        handler.close!();

        expect(res.written).toHaveLength(6);
        expect(parseSSEEvent(res.written[0]).type).toBe('typing');
        expect(parseSSEEvent(res.written[1]).type).toBe('status');
        expect(parseSSEEvent(res.written[2]).type).toBe('delta');
        expect(parseSSEEvent(res.written[3]).type).toBe('delta');
        expect(parseSSEEvent(res.written[4]).type).toBe('message');
        expect(parseSSEEvent(res.written[5]).type).toBe('done');
    });
});

describe('initSSEResponse', () => {
    it('should set correct SSE headers', () => {
        const res = createMockResponse();
        initSSEResponse(res);

        expect(res.headers['Content-Type']).toBe('text/event-stream');
        expect(res.headers['Cache-Control']).toBe('no-cache');
        expect(res.headers['Connection']).toBe('keep-alive');
    });
});
