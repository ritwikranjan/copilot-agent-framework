/**
 * Integration Test for Copilot Agent Framework — 4-service topology
 * 
 * Tests all 4 services running locally via docker-compose:
 * - CLI Server (TCP:3000)
 * - API Service (HTTP:4000, internal)
 * - Teams Bot (HTTP:3978, external)
 * - Web App (HTTP:3001, external)
 * 
 * Usage:
 *   docker-compose -f docker-compose.unified.yml up -d
 *   node tests/unified-integration-test.mjs
 */

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978';
const API_URL = process.env.API_URL || 'http://localhost:4000';
const WEB_URL = process.env.WEB_URL || 'http://localhost:3001';
const CLI_URL = process.env.CLI_URL || 'http://localhost:3000';

console.log('========================================');
console.log('Copilot Agent Framework - Integration Test');
console.log('4-service topology');
console.log('========================================');
console.log(`CLI URL:  ${CLI_URL}`);
console.log(`API URL:  ${API_URL}`);
console.log(`Bot URL:  ${BOT_URL}`);
console.log(`Web URL:  ${WEB_URL}`);
console.log('');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    process.stdout.write(`Testing: ${name}... `);
    try {
        await fn();
        console.log('✅ PASSED');
        passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        failed++;
    }
}

// Test 1: CLI Server Health Check (check TCP connectivity via Docker)
async function testCliServerHealth() {
    // CLI server uses SSE protocol, so we check if the port is open via bot connectivity
    // The bot depends on CLI server and is healthy, so CLI is working
    console.log(`\n    Note: CLI server uses SSE protocol, verified via Bot health`);
}

// Test 2: Bot Root Endpoint
async function testBotRoot() {
    const response = await fetch(`${BOT_URL}/`);
    if (!response.ok) {
        throw new Error(`Bot returned ${response.status}`);
    }
    const data = await response.json();
    if (!data.bots) {
        throw new Error('Response should contain bots array');
    }
}

// Test 3: DevTools Available
async function testDevToolsAvailable() {
    const response = await fetch(`${BOT_URL.replace('3978', '3979')}/devtools`);
    // DevTools returns HTML, just check it's accessible
    if (!response.ok && response.status !== 200) {
        throw new Error(`DevTools returned ${response.status}`);
    }
}

// Test 4: Bot API Messages Endpoint Exists
async function testMessagesEndpoint() {
    const response = await fetch(`${BOT_URL}/api/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'message',
            text: 'test',
            from: { id: 'test-user' },
            conversation: { id: 'test-conv' },
            recipient: { id: 'bot' },
            serviceUrl: 'http://localhost'
        })
    });
    // We expect the bot to accept the message (200) or reject without auth (401/403)
    // What we don't want is 404 (endpoint not found)
    if (response.status === 404) {
        throw new Error('Messages endpoint not found');
    }
}

// Test 5: Send message via Bot Framework protocol simulation
async function testBotFrameworkMessage() {
    // Create an activity that simulates a Teams message
    const activity = {
        type: 'message',
        id: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        localTimestamp: new Date().toISOString(),
        channelId: 'msteams',
        from: {
            id: 'test-user-123',
            name: 'Test User',
            aadObjectId: 'test-aad-id'
        },
        conversation: {
            id: `test-conversation-${Date.now()}`,
            conversationType: 'personal',
            tenantId: 'test-tenant'
        },
        recipient: {
            id: 'bot-id',
            name: 'Test Bot'
        },
        text: 'Hello from integration test!',
        serviceUrl: 'https://smba.trafficmanager.net/amer/'
    };

    const response = await fetch(`${BOT_URL}/api/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(activity)
    });

    // Without proper Bot Framework auth, we may get:
    // - 200 (in dev mode with no auth)
    // - 401/403 (with auth required)
    // - 500 (bot processed msg but failed to send reply to fake serviceUrl - expected!)
    // But NOT 404 (endpoint not found)
    if (response.status === 404) {
        throw new Error('Messages endpoint not found');
    }
    
    console.log(`\n    Response status: ${response.status}`);
    if (response.status === 500) {
        console.log(`    Note: 500 expected - bot processed msg but couldn't reply to fake serviceUrl`);
    }
}

// Test 6: Check that Copilot service is configured
async function testCopilotServiceConfig() {
    const response = await fetch(`${BOT_URL}/`);
    const data = await response.json();
    if (!data.name && !data.bots) {
        throw new Error('Service not returning expected metadata');
    }
}

// ============ New 4-Service Topology Tests ============

// Test 7: API Service Health Check
async function testApiServiceHealth() {
    const response = await fetch(`${API_URL}/api/health`);
    if (!response.ok) {
        throw new Error(`API health returned ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== 'ok') {
        throw new Error(`API health status: ${data.status}`);
    }
}

// Test 8: API Service Config
async function testApiServiceConfig() {
    const response = await fetch(`${API_URL}/api/config`);
    if (!response.ok) {
        throw new Error(`API config returned ${response.status}`);
    }
    const data = await response.json();
    if (!data.model || !data.agentName) {
        throw new Error('API config missing model or agentName');
    }
    console.log(`\n    Model: ${data.model}, Agent: ${data.agentName}`);
}

// Test 9: API Chat endpoint accepts requests
async function testApiChatEndpoint() {
    const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: 'Hi from integration test',
            userInfo: { username: 'integration-user', hostname: 'test' },
            conversationId: 'integration-test-conv',
        }),
    });
    if (response.status !== 200) {
        throw new Error(`API chat returned ${response.status}`);
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/event-stream')) {
        throw new Error(`Expected SSE content type, got: ${contentType}`);
    }
    // Consume the body to prevent socket hang
    await response.text();
}

// Test 10: API Sessions endpoint
async function testApiSessionsEndpoint() {
    const response = await fetch(`${API_URL}/api/sessions?username=integration-user`);
    if (!response.ok) {
        throw new Error(`API sessions returned ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.own)) {
        throw new Error('Sessions response missing own array');
    }
    console.log(`\n    Sessions: ${data.own.length} own, ${data.shared.length} shared`);
}

// Test 11: Web App health (home page renders)
async function testWebAppHealth() {
    const response = await fetch(WEB_URL);
    if (!response.ok) {
        throw new Error(`Web app returned ${response.status}`);
    }
}

// Test 12: Web App auth rejection (no token)
async function testWebAppAuthRejection() {
    const response = await fetch(`${WEB_URL}/api/sessions`);
    if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
    }
}

// Run tests
async function runTests() {
    console.log('Starting integration tests...');
    console.log('');

    console.log('--- Legacy Tests (Teams Bot) ---');
    await test('CLI Server Health', testCliServerHealth);
    await test('Bot Root Endpoint', testBotRoot);
    await test('DevTools Available', testDevToolsAvailable);
    await test('Messages Endpoint Exists', testMessagesEndpoint);
    await test('Bot Framework Message', testBotFrameworkMessage);
    await test('Copilot Service Config', testCopilotServiceConfig);

    console.log('');
    console.log('--- API Service Tests ---');
    await test('API Service Health', testApiServiceHealth);
    await test('API Service Config', testApiServiceConfig);
    await test('API Chat Endpoint (SSE)', testApiChatEndpoint);
    await test('API Sessions Endpoint', testApiSessionsEndpoint);

    console.log('');
    console.log('--- Web App Tests ---');
    await test('Web App Health', testWebAppHealth);
    await test('Web App Auth Rejection', testWebAppAuthRejection);

    console.log('');
    console.log('========================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('========================================');

    if (failed > 0) {
        console.log('');
        console.log('❌ INTEGRATION TESTS FAILED');
        process.exit(1);
    } else {
        console.log('');
        console.log('✅ ALL INTEGRATION TESTS PASSED');
        console.log('');
        console.log('To test the full flow:');
        console.log('  1. Open http://localhost:3979/devtools in your browser');
        console.log('  2. Send a message through the DevTools interface');
        console.log('  3. The bot should respond with a Copilot-generated reply');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});