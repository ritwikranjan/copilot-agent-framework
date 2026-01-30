/**
 * Comprehensive test suite for Copilot CLI Server
 * Runs inside test client container within VNet
 */

import { CopilotClient } from '@github/copilot-sdk';
import * as dns from 'dns';
import * as net from 'net';

const CLI_SERVER_URL = process.env.CLI_SERVER_URL;

if (!CLI_SERVER_URL) {
    console.error('ERROR: CLI_SERVER_URL environment variable not set');
    process.exit(1);
}

const [host, port] = CLI_SERVER_URL.split(':');
const portNum = parseInt(port) || 3000;

console.log('========================================');
console.log('Copilot CLI Server Test Suite');
console.log('========================================');
console.log(`Target: ${CLI_SERVER_URL}`);
console.log(`Host: ${host}`);
console.log(`Port: ${portNum}`);
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

// Test 1: DNS Resolution
async function testDnsResolution() {
    return new Promise((resolve, reject) => {
        dns.lookup(host, (err, address) => {
            if (err) {
                reject(new Error(`DNS lookup failed: ${err.message}`));
            } else if (!address) {
                reject(new Error('DNS returned no address'));
            } else {
                console.log(`(resolved to ${address}) `);
                resolve();
            }
        });
    });
}

// Test 2: TCP Connectivity
async function testTcpConnectivity() {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error('Connection timed out'));
        }, 10000);

        socket.connect(portNum, host, () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve();
        });

        socket.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`TCP connection failed: ${err.message}`));
        });
    });
}

// Test 3: SDK Client Creation
async function testSdkClientCreation() {
    const client = new CopilotClient({ cliUrl: CLI_SERVER_URL });
    // Just creating should work
    await client.stop();
}

// Test 4: Session Creation
async function testSessionCreation() {
    const client = new CopilotClient({ cliUrl: CLI_SERVER_URL });
    try {
        const session = await client.createSession({ model: 'gpt-4.1' });
        if (!session) {
            throw new Error('Session is null');
        }
    } finally {
        await client.stop();
    }
}

// Test 5: Send Message and Receive Response
async function testSendMessage() {
    const client = new CopilotClient({ cliUrl: CLI_SERVER_URL });
    try {
        const session = await client.createSession({ model: 'gpt-4.1' });
        const response = await session.sendAndWait({ 
            prompt: 'Reply with exactly: TEST_SUCCESS' 
        });
        
        const content = response?.data?.content || '';
        if (!content.includes('TEST_SUCCESS')) {
            throw new Error(`Unexpected response: ${content.substring(0, 100)}`);
        }
    } finally {
        await client.stop();
    }
}

// Test 6: Multiple Messages in Session
async function testMultipleMessages() {
    const client = new CopilotClient({ cliUrl: CLI_SERVER_URL });
    try {
        const session = await client.createSession({ model: 'gpt-4.1' });
        
        // First message
        await session.sendAndWait({ prompt: 'Remember the number 42' });
        
        // Second message referencing first
        const response = await session.sendAndWait({ 
            prompt: 'What number did I ask you to remember? Reply with just the number.' 
        });
        
        const content = response?.data?.content || '';
        if (!content.includes('42')) {
            throw new Error(`Session context not maintained: ${content}`);
        }
    } finally {
        await client.stop();
    }
}

// Run all tests
async function runTests() {
    console.log('Starting tests...');
    console.log('');

    await test('DNS Resolution', testDnsResolution);
    await test('TCP Connectivity', testTcpConnectivity);
    await test('SDK Client Creation', testSdkClientCreation);
    await test('Session Creation', testSessionCreation);
    await test('Send Message', testSendMessage);
    await test('Multiple Messages', testMultipleMessages);

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
