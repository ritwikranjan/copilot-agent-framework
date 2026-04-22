/**
 * API Service Integration Tests.
 *
 * Tests the API service endpoints against a running docker-compose stack.
 * Verifies health, chat SSE streaming, session lifecycle, sharing, and cross-user isolation.
 *
 * Run: node tests/api-integration-test.mjs
 * Prereq: docker-compose -f docker-compose.unified.yml up -d
 */

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(name, condition, detail) {
        if (condition) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name}: ${detail || 'assertion failed'}`);
            failed++;
        }
    }

    //  1. Health check
    console.log('--- Health Check ---');
    try {
        const res = await fetch(`${API_URL}/api/health`);
        assert('GET /api/health returns 200', res.status === 200, `status=${res.status}`);
        const body = await res.json();
        assert('Health response has status=ok', body.status === 'ok', `status=${body.status}`);
    } catch (err) {
        assert('Health check reachable', false, err.message);
    }

    //  2. Config endpoint
    console.log('--- Config ---');
    try {
        const res = await fetch(`${API_URL}/api/config`);
        assert('GET /api/config returns 200', res.status === 200, `status=${res.status}`);
        const body = await res.json();
        assert('Config has model', !!body.model, `model=${body.model}`);
        assert('Config has agentName', !!body.agentName, `agent=${body.agentName}`);
    } catch (err) {
        assert('Config reachable', false, err.message);
    }

    //  3. Sessions list (empty)
    console.log('--- Sessions ---');
    try {
        const res = await fetch(`${API_URL}/api/sessions?username=integration-test-user`);
        assert('GET /api/sessions returns 200', res.status === 200, `status=${res.status}`);
        const body = await res.json();
        assert('Sessions has own array', Array.isArray(body.own), 'own is not array');
        assert('Sessions has shared array', Array.isArray(body.shared), 'shared is not array');
    } catch (err) {
        assert('Sessions reachable', false, err.message);
    }

    //  4. Chat with SSE streaming
    console.log('--- Chat (SSE) ---');
    try {
        const res = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Hello from integration test',
                userInfo: { username: 'integration-test-user', hostname: 'test' },
                conversationId: 'integration-test-conv',
            }),
        });
        assert('POST /api/chat returns 200', res.status === 200, `status=${res.status}`);

        const contentType = res.headers.get('content-type');
        assert('Content-Type is text/event-stream', contentType?.includes('text/event-stream'), `ct=${contentType}`);

        // Parse SSE stream
        const text = await res.text();
        const events = text.split('\n\n').filter(e => e.startsWith('data: ')).map(e => {
            try { return JSON.parse(e.replace('data: ', '')); }
            catch { return null; }
        }).filter(Boolean);

        assert('SSE stream has events', events.length > 0, `events=${events.length}`);
        const hasMessage = events.some(e => e.type === 'message');
        const hasDone = events.some(e => e.type === 'done');
        assert('SSE stream contains message or done event', hasMessage || hasDone, `types=${events.map(e => e.type)}`);
    } catch (err) {
        assert('Chat reachable', false, err.message);
    }

    //  5. Cross-user isolation
    console.log('--- Cross-user Isolation ---');
    try {
        const res = await fetch(`${API_URL}/api/sessions?username=other-user`);
        const body = await res.json();
        const hasTestUserSessions = body.own.some(s => s.user_info?.username === 'integration-test-user');
        assert('Other user cannot see test user sessions', !hasTestUserSessions);
    } catch (err) {
        assert('Isolation check', false, err.message);
    }

    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
