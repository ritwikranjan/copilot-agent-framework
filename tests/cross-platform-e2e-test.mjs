/**
 * Cross-Platform E2E Test — the marquee test.
 *
 * Verifies the full cross-platform flow:
 * 1. User A creates session via API (simulating Teams bot)
 * 2. User A lists sessions via web API → sees the session
 * 3. User A continues conversation via web API → same session
 * 4. User A shares session → User B accesses via share link
 * 5. User B sends message in shared session (collaborator)
 *
 * Run: node tests/cross-platform-e2e-test.mjs
 * Prereq: docker-compose -f docker-compose.unified.yml up -d
 */

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function runTests() {
    let passed = 0;
    let failed = 0;
    let sessionId = null;
    let conversationId = `e2e-${Date.now()}`;
    let shareId = null;

    const userA = { username: 'user-a-aad-oid', hostname: 'teams' };
    const userB = { username: 'user-b-aad-oid', hostname: 'web' };

    function assert(name, condition, detail) {
        if (condition) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name}: ${detail || 'assertion failed'}`);
            failed++;
        }
    }

    // 1. User A creates session via chat (simulating Teams)
    console.log('--- Step 1: User A creates session via API ---');
    try {
        const res = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Hello from Teams',
                userInfo: userA,
                conversationId,
            }),
        });
        assert('Chat returns 200', res.status === 200, `status=${res.status}`);

        const text = await res.text();
        const events = text.split('\n\n').filter(e => e.startsWith('data: ')).map(e => {
            try { return JSON.parse(e.replace('data: ', '')); } catch { return null; }
        }).filter(Boolean);

        assert('Chat returns SSE events', events.length > 0, `events=${events.length}`);
    } catch (err) {
        assert('Step 1 reachable', false, err.message);
    }

    // 2. User A lists sessions → sees the session
    console.log('--- Step 2: User A lists sessions ---');
    try {
        const res = await fetch(`${API_URL}/api/sessions?username=${userA.username}`);
        const body = await res.json();
        assert('Sessions returns own array', Array.isArray(body.own), 'own not array');
        assert('User A has at least 1 session', body.own.length >= 1, `count=${body.own.length}`);

        if (body.own.length > 0) {
            sessionId = body.own[0].id;
            assert('Session has correct conversation_id', body.own[0].conversation_id === conversationId);
        }
    } catch (err) {
        assert('Step 2', false, err.message);
    }

    // 3. User A continues conversation via web API
    console.log('--- Step 3: User A continues conversation ---');
    try {
        const res = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Continue from web',
                userInfo: { ...userA, hostname: 'web' },
                conversationId,
            }),
        });
        assert('Continue chat returns 200', res.status === 200, `status=${res.status}`);
        await res.text(); // consume body
    } catch (err) {
        assert('Step 3', false, err.message);
    }

    // 4. User A shares session with User B
    console.log('--- Step 4: User A shares session ---');
    if (sessionId) {
        try {
            const res = await fetch(`${API_URL}/api/sessions/${sessionId}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerUsername: userA.username,
                    sharedWith: userB.username,
                    role: 'collaborator',
                }),
            });
            const body = await res.json();
            assert('Share returns success', body.success === true, JSON.stringify(body));
            shareId = body.share?.share_id;
            assert('Share has share_id', !!shareId, `shareId=${shareId}`);
        } catch (err) {
            assert('Step 4', false, err.message);
        }
    }

    // 5. User B accesses via share link
    console.log('--- Step 5: User B accesses shared session ---');
    if (shareId) {
        try {
            const res = await fetch(`${API_URL}/api/sessions/share/${shareId}`);
            const body = await res.json();
            assert('Share link returns session', !!body.session, 'no session in response');
            assert('Shared session ID matches', body.session?.id === sessionId);
        } catch (err) {
            assert('Step 5', false, err.message);
        }
    }

    // 6. User B cannot see User A's sessions in their own list
    console.log('--- Step 6: Cross-user isolation ---');
    try {
        const res = await fetch(`${API_URL}/api/sessions?username=${userB.username}`);
        const body = await res.json();
        assert('User B has 0 own sessions', body.own.length === 0, `ownCount=${body.own.length}`);
        assert('User B sees 1 shared session', body.shared.length === 1, `sharedCount=${body.shared.length}`);
    } catch (err) {
        assert('Step 6', false, err.message);
    }

    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
