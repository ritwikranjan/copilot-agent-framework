/**
 * Integration Test Script for Deployed API Service
 * 
 * Tests the API service deployed to Azure Container Apps.
 * Can use either:
 * - Azure CLI (az account get-access-token) for local/manual testing
 * - Managed Identity for CI/CD pipelines
 * 
 * Prerequisites:
 *   - API Service deployed to Azure
 *   - Either: Azure CLI logged in, or running with Managed Identity
 * 
 * Usage:
 *   # Using Azure CLI (local testing)
 *   node tests/integration-test.mjs --api-url https://your-api.azurecontainerapps.io
 * 
 *   # Using Managed Identity (CI/CD)
 *   node tests/integration-test.mjs --api-url https://your-api.azurecontainerapps.io --use-managed-identity
 * 
 * Environment Variables:
 *   API_URL - API service URL (alternative to --api-url)
 *   AZURE_CLIENT_ID - Azure AD Client ID (default: 87a8f0f7-46fc-4c9f-aebf-c3ff4a2aa191)
 *   USE_MANAGED_IDENTITY - Set to 'true' to use managed identity
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
let apiUrl = process.env.API_URL;
let useManagedIdentity = process.env.USE_MANAGED_IDENTITY === 'true';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-url' && args[i + 1]) {
        apiUrl = args[i + 1];
        i++;
    } else if (args[i] === '--use-managed-identity') {
        useManagedIdentity = true;
    }
}

if (!apiUrl) {
    console.error('ERROR: API URL is required');
    console.error('Usage: node tests/integration-test.mjs --api-url <url>');
    process.exit(1);
}

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '87a8f0f7-46fc-4c9f-aebf-c3ff4a2aa191';
const AZURE_SCOPE = process.env.AZURE_SCOPE || `api://${AZURE_CLIENT_ID}/copilotApi`;

console.log('========================================');
console.log('API Service - Integration Test');
console.log('========================================');
console.log(`API URL: ${apiUrl}`);
console.log(`Azure Client ID: ${AZURE_CLIENT_ID}`);
console.log(`Auth Method: ${useManagedIdentity ? 'Managed Identity' : 'Azure CLI'}`);
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

/**
 * Get Azure AD access token using Azure CLI
 */
async function getAccessTokenAzCli() {
    try {
        const { stdout } = await execAsync(`az account get-access-token --scope "${AZURE_SCOPE}" --query accessToken -o tsv`);
        return stdout.trim();
    } catch (error) {
        throw new Error(`Failed to get access token via Azure CLI: ${error.message}`);
    }
}

/**
 * Get Azure AD access token using Managed Identity
 * Uses Azure Instance Metadata Service (IMDS)
 */
async function getAccessTokenManagedIdentity() {
    const imdsEndpoint = 'http://169.254.169.254/metadata/identity/oauth2/token';
    const params = new URLSearchParams({
        'api-version': '2019-08-01',
        'resource': `api://${AZURE_CLIENT_ID}`
    });
    
    try {
        const response = await fetch(`${imdsEndpoint}?${params}`, {
            headers: {
                'Metadata': 'true'
            }
        });
        
        if (!response.ok) {
            throw new Error(`IMDS returned ${response.status}`);
        }
        
        const data = await response.json();
        return data.access_token;
    } catch (error) {
        // Fallback: Try Azure Identity DefaultAzureCredential approach
        // This works in Azure Container Apps with managed identity
        try {
            const tokenEndpoint = process.env.IDENTITY_ENDPOINT;
            const tokenHeader = process.env.IDENTITY_HEADER;
            
            if (tokenEndpoint && tokenHeader) {
                const response = await fetch(
                    `${tokenEndpoint}?api-version=2019-08-01&resource=api://${AZURE_CLIENT_ID}`,
                    {
                        headers: {
                            'X-IDENTITY-HEADER': tokenHeader
                        }
                    }
                );
                
                if (response.ok) {
                    const data = await response.json();
                    return data.access_token;
                }
            }
        } catch (e) {
            // Ignore fallback errors
        }
        
        throw new Error(`Failed to get access token via Managed Identity: ${error.message}`);
    }
}

/**
 * Get access token based on configuration
 */
async function getAccessToken() {
    if (useManagedIdentity) {
        return await getAccessTokenManagedIdentity();
    } else {
        return await getAccessTokenAzCli();
    }
}

/**
 * Make HTTP request to API
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${apiUrl}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    return response;
}

// Test 1: Health Check
async function testHealthCheck() {
    const response = await apiRequest('/health');
    if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== 'healthy') {
        throw new Error(`Unexpected health status: ${data.status}`);
    }
}

// Test 2: Unauthenticated request should be rejected
async function testUnauthenticated() {
    const response = await apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' })
    });
    if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
    }
}

// Test 3: Get valid token
let accessToken = null;
async function testGetToken() {
    accessToken = await getAccessToken();
    if (!accessToken || accessToken.length < 100) {
        throw new Error('Token appears invalid (too short)');
    }
}

// Test 4: Authenticated chat request
async function testAuthenticatedChat() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ message: 'What service are you?' })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${text}`);
    }
    
    const data = await response.json();
    if (!data.success) {
        throw new Error(`Response not successful: ${JSON.stringify(data)}`);
    }
    if (!data.response) {
        throw new Error('No response content');
    }
    
    console.log(`\n    Response preview: "${data.response.substring(0, 80)}..."`);
}

// Test 5: Multiple sequential requests
async function testMultipleRequests() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const messages = [
        'Say hello',
        'What is 2+2?',
        'Thanks!'
    ];
    
    for (const message of messages) {
        const response = await apiRequest('/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ message })
        });
        
        if (!response.ok) {
            throw new Error(`Request for "${message}" failed with status ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(`Request for "${message}" not successful`);
        }
    }
}

// Test 6: Response time check
async function testResponseTime() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const start = Date.now();
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ message: 'Reply with just "OK"' })
    });
    const elapsed = Date.now() - start;
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    // Warn if response takes too long, but don't fail
    if (elapsed > 30000) {
        console.log(`\n    Warning: Response took ${elapsed}ms (>30s)`);
    } else {
        console.log(`\n    Response time: ${elapsed}ms`);
    }
}

// ============ Session & Audit Tests ============

// Test 7: Get sessions list (authenticated)
async function testGetSessions() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const response = await apiRequest('/sessions', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${text}`);
    }
    
    const data = await response.json();
    if (!data.success) {
        throw new Error(`Response not successful: ${JSON.stringify(data)}`);
    }
    if (!Array.isArray(data.sessions)) {
        throw new Error('Sessions should be an array');
    }
    
    console.log(`\n    Found ${data.sessions.length} existing session(s)`);
}

// Test 8: Chat creates a new session and returns sessionId
let testSessionId = null;
async function testChatCreatesSession() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ message: 'Integration test - creating new session' })
    });
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.sessionId) {
        throw new Error('Chat response should include sessionId');
    }
    
    testSessionId = data.sessionId;
    console.log(`\n    Created session: ${testSessionId}`);
}

// Test 9: Session persisted in database
async function testSessionPersisted() {
    if (!accessToken || !testSessionId) {
        throw new Error('No access token or session ID available');
    }
    
    const response = await apiRequest('/sessions', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    const foundSession = data.sessions.find(s => s.id === testSessionId);
    
    if (!foundSession) {
        throw new Error(`Session ${testSessionId} not found in sessions list`);
    }
    
    if (foundSession.status !== 'active') {
        throw new Error(`Expected status 'active', got '${foundSession.status}'`);
    }
    
    console.log(`\n    Session verified in database`);
}

// Test 10: Get specific session by ID
async function testGetSessionById() {
    if (!accessToken || !testSessionId) {
        throw new Error('No access token or session ID available');
    }
    
    const response = await apiRequest(`/sessions/${testSessionId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.success) {
        throw new Error(`Response not successful: ${JSON.stringify(data)}`);
    }
    if (data.session.id !== testSessionId) {
        throw new Error(`Session ID mismatch: expected ${testSessionId}, got ${data.session.id}`);
    }
    
    console.log(`\n    Session details retrieved successfully`);
}

// Test 11: Rename session
const testSessionName = `Integration-Test-${Date.now()}`;
async function testRenameSession() {
    if (!accessToken || !testSessionId) {
        throw new Error('No access token or session ID available');
    }
    
    const response = await apiRequest(`/sessions/${testSessionId}/name`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ name: testSessionName })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${text}`);
    }
    
    const data = await response.json();
    if (!data.success) {
        throw new Error(`Response not successful: ${JSON.stringify(data)}`);
    }
    if (data.session.name !== testSessionName) {
        throw new Error(`Session name not updated: expected ${testSessionName}, got ${data.session.name}`);
    }
    
    console.log(`\n    Session renamed to: ${testSessionName}`);
}

// Test 12: Resume session by name
async function testResumeSessionByName() {
    if (!accessToken || !testSessionId) {
        throw new Error('No access token or session ID available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ 
            message: 'Continuing our conversation',
            sessionName: testSessionName
        })
    });
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    if (data.sessionId !== testSessionId) {
        throw new Error(`Expected to resume session ${testSessionId}, but got ${data.sessionId}`);
    }
    
    console.log(`\n    Successfully resumed session by name`);
}

// Test 13: Resume session by ID
async function testResumeSessionById() {
    if (!accessToken || !testSessionId) {
        throw new Error('No access token or session ID available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ 
            message: 'Another message in the same session',
            sessionId: testSessionId
        })
    });
    
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    if (data.sessionId !== testSessionId) {
        throw new Error(`Expected session ${testSessionId}, but got ${data.sessionId}`);
    }
    
    console.log(`\n    Successfully resumed session by ID`);
}

// Test 14: Session not found error
async function testSessionNotFound() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const fakeSessionId = '00000000-0000-0000-0000-000000000000';
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ 
            message: 'This should fail',
            sessionId: fakeSessionId
        })
    });
    
    // Should return 404 for non-existent session
    if (response.status !== 404) {
        throw new Error(`Expected 404 for non-existent session, got ${response.status}`);
    }
    
    console.log(`\n    Correctly returned 404 for non-existent session`);
}

// Test 15: Unauthenticated sessions endpoint rejected
async function testSessionsUnauthenticated() {
    const response = await apiRequest('/sessions', {
        method: 'GET'
    });
    
    if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
    }
}

// Run all tests
async function runTests() {
    console.log('Starting integration tests...');
    console.log('');

    // Basic connectivity
    await test('Health Check', testHealthCheck);
    await test('Unauthenticated Request Rejected', testUnauthenticated);
    
    // Authentication
    await test('Get Access Token', testGetToken);
    
    // Authenticated operations
    await test('Authenticated Chat', testAuthenticatedChat);
    await test('Multiple Sequential Requests', testMultipleRequests);
    await test('Response Time', testResponseTime);
    
    // Session Management Tests
    console.log('');
    console.log('--- Session & Audit Tests ---');
    await test('Sessions Endpoint Unauthenticated Rejected', testSessionsUnauthenticated);
    await test('Get Sessions List', testGetSessions);
    await test('Chat Creates New Session', testChatCreatesSession);
    await test('Session Persisted in Database', testSessionPersisted);
    await test('Get Session By ID', testGetSessionById);
    await test('Rename Session', testRenameSession);
    await test('Resume Session By Name', testResumeSessionByName);
    await test('Resume Session By ID', testResumeSessionById);
    await test('Session Not Found Returns 404', testSessionNotFound);

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
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});