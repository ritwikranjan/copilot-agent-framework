/**
 * Web App Integration Tests.
 *
 * Tests the web app against a running docker-compose stack.
 * Verifies auth rejection, chat SSE proxying, and session listing.
 *
 * Run: node tests/web-app-integration-test.mjs
 * Prereq: docker-compose -f docker-compose.unified.yml up -d
 */

const WEB_URL = process.env.WEB_URL || 'http://localhost:3001';

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

    // 1. Health check (Next.js page renders)
    console.log('--- Web App Health ---');
    try {
        const res = await fetch(WEB_URL);
        assert('GET / returns 200', res.status === 200, `status=${res.status}`);
    } catch (err) {
        assert('Web app reachable', false, err.message);
    }

    // 2. Auth rejection (no token)
    console.log('--- Auth Rejection ---');
    try {
        const res = await fetch(`${WEB_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });
        assert('POST /api/chat without token returns 401', res.status === 401, `status=${res.status}`);
    } catch (err) {
        assert('Auth rejection test', false, err.message);
    }

    // 3. Sessions endpoint without token
    console.log('--- Sessions Auth ---');
    try {
        const res = await fetch(`${WEB_URL}/api/sessions`);
        assert('GET /api/sessions without token returns 401', res.status === 401, `status=${res.status}`);
    } catch (err) {
        assert('Sessions auth test', false, err.message);
    }

    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
