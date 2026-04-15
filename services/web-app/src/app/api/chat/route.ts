/**
 * POST /api/chat — Proxy chat requests to internal API with SSE passthrough.
 *
 * Validates Entra ID token, extracts userInfo, forwards to internal API,
 * pipes SSE response back to browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

const API_URL = process.env.API_URL || 'http://localhost:4000';

export const POST = withAuth(async (req: NextRequest, user) => {
    const startTime = Date.now();
    const body = await req.json();

    const { message, conversationId } = body as {
        message?: string;
        conversationId?: string;
    };

    if (!message) {
        return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    console.log(`[Proxy] POST /api/chat → API (user=${user.oid})`);

    try {
        const apiResponse = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                userInfo: { username: user.oid, hostname: 'web' },
                conversationId,
            }),
        });

        const latency = Date.now() - startTime;
        console.log(`[Proxy] POST /api/chat response ${apiResponse.status} (${latency}ms)`);

        if (!apiResponse.ok || !apiResponse.body) {
            const errorText = await apiResponse.text();
            return NextResponse.json({ error: errorText }, { status: apiResponse.status });
        }

        // Pipe SSE stream back to client
        return new NextResponse(apiResponse.body, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error(`[Proxy] POST /api/chat error:`, (error as Error).message);
        return NextResponse.json({ error: 'API service unreachable' }, { status: 502 });
    }
});
