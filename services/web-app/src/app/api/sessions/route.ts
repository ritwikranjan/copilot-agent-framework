/**
 * Session API routes — proxy to internal API.
 *
 * GET /api/sessions — list user's sessions
 * GET /api/sessions?action=history&id=X — get session history
 * POST /api/sessions — share or other session actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthUser } from '@/lib/auth';

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function proxyGet(path: string): Promise<NextResponse> {
    try {
        const res = await fetch(`${API_URL}${path}`);
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        console.error(`[Proxy] GET ${path} error:`, (error as Error).message);
        return NextResponse.json({ error: 'API service unreachable' }, { status: 502 });
    }
}

async function proxyPost(path: string, body: unknown): Promise<NextResponse> {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        console.error(`[Proxy] POST ${path} error:`, (error as Error).message);
        return NextResponse.json({ error: 'API service unreachable' }, { status: 502 });
    }
}

/** GET /api/sessions — list sessions for authenticated user */
export const GET = withAuth(async (req: NextRequest, user: AuthUser) => {
    const { searchParams } = req.nextUrl;
    const sessionId = searchParams.get('id');
    const action = searchParams.get('action');

    if (action === 'history' && sessionId) {
        console.log(`[Proxy] GET /api/sessions/${sessionId}/history (user=${user.oid})`);
        return proxyGet(`/api/sessions/${sessionId}/history?username=${encodeURIComponent(user.oid)}`);
    }

    if (action === 'shared') {
        console.log(`[Proxy] GET /api/sessions/shared (user=${user.oid})`);
        return proxyGet(`/api/sessions/shared?username=${encodeURIComponent(user.oid)}`);
    }

    console.log(`[Proxy] GET /api/sessions (user=${user.oid})`);
    return proxyGet(`/api/sessions?username=${encodeURIComponent(user.oid)}`);
});

/** POST /api/sessions — session actions (share, end, resume) */
export const POST = withAuth(async (req: NextRequest, user: AuthUser) => {
    const body = await req.json() as { action: string; sessionId?: string; conversationId?: string; sharedWith?: string; role?: string };

    switch (body.action) {
        case 'share':
            if (!body.sessionId || !body.sharedWith) {
                return NextResponse.json({ error: 'Missing sessionId or sharedWith' }, { status: 400 });
            }
            console.log(`[Proxy] POST share session=${body.sessionId} (user=${user.oid})`);
            return proxyPost(`/api/sessions/${body.sessionId}/share`, {
                ownerUsername: user.oid,
                sharedWith: body.sharedWith,
                role: body.role || 'collaborator',
            });

        case 'end':
            if (!body.sessionId) {
                return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
            }
            console.log(`[Proxy] POST end session=${body.sessionId} (user=${user.oid})`);
            return proxyPost(`/api/sessions/${body.sessionId}/end`, {
                username: user.oid,
            });

        case 'resume':
            if (!body.conversationId) {
                return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
            }
            console.log(`[Proxy] POST resume conv=${body.conversationId} (user=${user.oid})`);
            return proxyPost(`/api/sessions/_/resume`, {
                username: user.oid,
                conversationId: body.conversationId,
            });

        default:
            return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
});
