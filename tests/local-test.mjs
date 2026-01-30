/**
 * Local Test Script for Base API Service
 * 
 * Tests the API service running in Docker Compose.
 * Acquires an Azure AD token and calls the /chat endpoint.
 * 
 * Prerequisites:
 *   - Docker Compose services running (docker-compose -f docker-compose.test.yml up)
 *   - Azure CLI installed and logged in (az login)
 *   - Access to the configured Azure AD app
 * 
 * Usage:
 *   node tests/local-test.mjs
 * 
 * Environment Variables:
 *   API_URL - Base API service URL (default: http://localhost:8080)
 *   AZURE_CLIENT_ID - Azure AD app client ID (default: 87a8f0f7-46fc-4c9f-aebf-c3ff4a2aa191)
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const API_URL = process.env.API_URL || 'http://localhost:8080';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '87a8f0f7-46fc-4c9f-aebf-c3ff4a2aa191';
const AZURE_SCOPE = process.env.AZURE_SCOPE || `api://${AZURE_CLIENT_ID}/copilotApi`;

console.log('========================================');
console.log('Base API Service - Local Test');
console.log('========================================');
console.log(`API URL: ${API_URL}`);
console.log(`Azure Client ID: ${AZURE_CLIENT_ID}`);
console.log(`Azure Scope: ${AZURE_SCOPE}`);
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
async function getAccessToken() {
    try {
        const { stdout } = await execAsync(`az account get-access-token --scope "${AZURE_SCOPE}" --query accessToken -o tsv`);
        return stdout.trim();
    } catch (error) {
        throw new Error(`Failed to get access token: ${error.message}. Make sure you're logged in with 'az login'`);
    }
}

/**
 * Make HTTP request to API
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    return response;
}

// Test 1: Health Check (no auth required)
async function testHealthCheck() {
    const response = await apiRequest('/health');
    if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== 'healthy') {
        throw new Error(`Unexpected health status: ${data.status}`);
    }
    if (data.service !== 'base-api') {
        throw new Error(`Unexpected service name: ${data.service}`);
    }
}

// Test 2: Chat without auth (should fail)
async function testChatNoAuth() {
    const response = await apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' })
    });
    if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
    }
}

// Test 3: Chat with invalid token (should fail)
async function testChatInvalidToken() {
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer invalid-token-here'
        },
        body: JSON.stringify({ message: 'Hello' })
    });
    if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
    }
}

// Test 4: Get valid token
let accessToken = null;
async function testGetToken() {
    accessToken = await getAccessToken();
    if (!accessToken || accessToken.length < 100) {
        throw new Error('Token appears invalid (too short)');
    }
}

// Test 5: Chat with valid token
async function testChatWithAuth() {
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
    
    // Check for expected marker from system prompt
    const responseText = data.response.toLowerCase();
    if (!responseText.includes('base api service') && !responseText.includes('copilot')) {
        console.log(`\n    Response: "${data.response.substring(0, 100)}..."`);
        // Don't fail - the model might phrase it differently
    }
}

// Test 6: Chat with empty message (should fail validation)
async function testChatEmptyMessage() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ message: '' })
    });
    
    // Empty message should return 400
    if (response.status !== 400) {
        throw new Error(`Expected 400, got ${response.status}`);
    }
}

// Test 7: Chat with missing message field (should fail validation)
async function testChatMissingMessage() {
    if (!accessToken) {
        throw new Error('No access token available');
    }
    
    const response = await apiRequest('/chat', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ prompt: 'wrong field name' })
    });
    
    if (response.status !== 400) {
        throw new Error(`Expected 400, got ${response.status}`);
    }
}

// Run all tests
async function runTests() {
    console.log('Starting tests...');
    console.log('');

    // Basic connectivity tests
    await test('Health Check', testHealthCheck);
    await test('Chat without Auth (expect 401)', testChatNoAuth);
    await test('Chat with Invalid Token (expect 401)', testChatInvalidToken);
    
    // Token acquisition
    await test('Get Azure AD Token', testGetToken);
    
    // Authenticated tests
    await test('Chat with Valid Token', testChatWithAuth);
    await test('Chat with Empty Message (expect 400)', testChatEmptyMessage);
    await test('Chat with Missing Message (expect 400)', testChatMissingMessage);

    console.log('');
    console.log('========================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('========================================');

    if (failed > 0) {
        console.log('');
        console.log('❌ TEST SUITE FAILED');
        process.exit(1);
    } else {
        console.log('');
        console.log('✅ ALL TESTS PASSED');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});