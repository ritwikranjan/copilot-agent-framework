/**
 * End-to-End Test for Unified Teams Copilot Agent
 * 
 * This test starts a local mock service URL server to receive the bot's replies,
 * sends a message to the bot, and verifies the Copilot response.
 * 
 * Usage:
 *   docker-compose -f docker-compose.unified.yml up -d
 *   node tests/unified-e2e-test.mjs
 */

import http from 'http';

const BOT_URL = process.env.BOT_URL || 'http://localhost:3978';
const MOCK_SERVICE_PORT = 4000;

console.log('========================================');
console.log('Teams Copilot Agent - E2E Test');
console.log('========================================');
console.log(`Bot URL: ${BOT_URL}`);
console.log(`Mock Service Port: ${MOCK_SERVICE_PORT}`);
console.log('');

// Store received activities
let receivedActivities = [];

// Create mock service URL server
function createMockServiceServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                console.log(`[Mock Service] ${req.method} ${req.url}`);
                
                try {
                    if (req.method === 'POST' && body) {
                        const activity = JSON.parse(body);
                        console.log(`[Mock Service] Received activity type: ${activity.type}`);
                        if (activity.text) {
                            console.log(`[Mock Service] Text: ${activity.text.substring(0, 100)}...`);
                        }
                        receivedActivities.push(activity);
                    }
                } catch (e) {
                    console.log(`[Mock Service] Parse error: ${e.message}`);
                }
                
                // Always respond 200 OK (Bot Framework expects this)
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: `reply-${Date.now()}` }));
            });
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${MOCK_SERVICE_PORT} in use, trying ${MOCK_SERVICE_PORT + 1}`);
                server.listen(MOCK_SERVICE_PORT + 1, () => {
                    console.log(`[Mock Service] Started on port ${MOCK_SERVICE_PORT + 1}`);
                    resolve({ server, port: MOCK_SERVICE_PORT + 1 });
                });
            } else {
                reject(err);
            }
        });

        server.listen(MOCK_SERVICE_PORT, () => {
            console.log(`[Mock Service] Started on port ${MOCK_SERVICE_PORT}`);
            resolve({ server, port: MOCK_SERVICE_PORT });
        });
    });
}

// Send a message to the bot
async function sendMessageToBot(servicePort, message) {
    const activity = {
        type: 'message',
        id: `msg-${Date.now()}`,
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
        text: message,
        // Point to our mock server - use host.docker.internal for Docker
        serviceUrl: `http://host.docker.internal:${servicePort}`
    };

    console.log(`[Test] Sending message: "${message}"`);
    console.log(`[Test] Service URL: ${activity.serviceUrl}`);

    const response = await fetch(`${BOT_URL}/api/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(activity)
    });

    console.log(`[Test] Bot response status: ${response.status}`);
    return response;
}

// Wait for activities to be received
async function waitForActivities(expectedCount, timeoutMs = 30000) {
    const startTime = Date.now();
    while (receivedActivities.length < expectedCount) {
        if (Date.now() - startTime > timeoutMs) {
            throw new Error(`Timeout waiting for activities (got ${receivedActivities.length}, expected ${expectedCount})`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        process.stdout.write('.');
    }
    console.log('');
    return receivedActivities;
}

// Main test
async function runE2ETest() {
    let mockServer;
    
    try {
        // 1. Start mock service server
        console.log('\n--- Step 1: Start Mock Service Server ---');
        const { server, port } = await createMockServiceServer();
        mockServer = server;

        // 2. Send message to bot
        console.log('\n--- Step 2: Send Message to Bot ---');
        receivedActivities = [];
        const response = await sendMessageToBot(port, 'Hello! What can you do?');
        
        if (response.status >= 400 && response.status !== 500) {
            throw new Error(`Bot rejected message with status ${response.status}`);
        }

        // 3. Wait for bot to send reply to our mock server
        console.log('\n--- Step 3: Wait for Bot Reply ---');
        console.log('[Test] Waiting for bot to call our mock service URL');
        
        // The bot typically sends:
        // 1. A "typing" activity
        // 2. The actual message response
        // Wait up to 30 seconds for at least 1 activity
        const activities = await waitForActivities(1, 30000);

        // 4. Verify the response
        console.log('\n--- Step 4: Verify Response ---');
        console.log(`[Test] Received ${activities.length} activities`);
        
        // Find the message activity (not typing)
        const messageActivity = activities.find(a => a.type === 'message' && a.text);
        
        if (messageActivity) {
            console.log('\n========================================');
            console.log('✅ E2E TEST PASSED');
            console.log('========================================');
            console.log('Bot Reply:');
            console.log(`  ${messageActivity.text}`);
            console.log('========================================');
            return true;
        } else {
            // Check if we got typing indicator (partial success)
            const typingActivity = activities.find(a => a.type === 'typing');
            if (typingActivity) {
                console.log('[Test] Received typing indicator but no message yet');
                console.log('[Test] Waiting longer for message...');
                const moreActivities = await waitForActivities(activities.length + 1, 30000);
                const msg = moreActivities.find(a => a.type === 'message' && a.text);
                if (msg) {
                    console.log('\n========================================');
                    console.log('✅ E2E TEST PASSED');
                    console.log('========================================');
                    console.log('Bot Reply:');
                    console.log(`  ${msg.text}`);
                    console.log('========================================');
                    return true;
                }
            }
            
            console.log('\n❌ E2E TEST FAILED: No message response received');
            console.log('Received activities:', activities.map(a => ({ type: a.type, hasText: !!a.text })));
            return false;
        }

    } catch (error) {
        console.log(`\n❌ E2E TEST FAILED: ${error.message}`);
        return false;
    } finally {
        if (mockServer) {
            mockServer.close();
            console.log('\n[Mock Service] Server stopped');
        }
    }
}

// Run
runE2ETest().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});