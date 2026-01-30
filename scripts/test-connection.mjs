/**
 * Test script to verify connection to remote Copilot CLI server
 * Usage: node test-connection.mjs <cliUrl>
 */

import { CopilotClient } from '@github/copilot-sdk';

const cliUrl = process.argv[2];

if (!cliUrl) {
    console.error('Usage: node test-connection.mjs <cliUrl>');
    console.error('Example: node test-connection.mjs copilot-cli-app.example.com:3000');
    process.exit(1);
}

console.log(`Testing connection to: ${cliUrl}`);
console.log('');

try {
    const client = new CopilotClient({ cliUrl });
    
    console.log('Creating session...');
    const session = await client.createSession({ model: 'gpt-4.1' });
    
    console.log('Sending test message...');
    const response = await session.sendAndWait({ 
        prompt: 'Say "Connection successful!" and nothing else.' 
    });
    
    console.log('');
    console.log('Response:', response?.data?.content);
    console.log('');
    console.log('✅ Connection test passed!');
    
    await client.stop();
    process.exit(0);
} catch (error) {
    console.error('');
    console.error('❌ Connection test failed!');
    console.error('Error:', error.message);
    process.exit(1);
}
