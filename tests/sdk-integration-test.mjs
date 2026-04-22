/**
 * SDK Integration Tests — End-to-end tests for processMessage() and sharing.
 *
 * These tests use InMemoryStores (no external dependencies) and verify
 * the full lifecycle of the SDK's public API.
 *
 * Run: node tests/sdk-integration-test.mjs
 * Prereq: npm run build in packages/stateless-copilot-sdk (or use ts-node)
 */

// NOTE: These tests will be fleshed out in Phase 7 when docker-compose
// integrates all services. The unit tests in the SDK package cover the
// same flows with mocked CopilotClient — these integration tests are
// for verifying the real CopilotClient against a running CLI server.

console.log('=== SDK Integration Tests ===');
console.log('');
console.log('These tests require a running CLI server (copilot --server on TCP:3000).');
console.log('Run via docker-compose: docker-compose -f docker-compose.unified.yml up -d');
console.log('');

const API_URL = process.env.CLI_URL || 'localhost:3000';

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

    console.log('--- processMessage() flow ---');
    console.log('  ⏭️  Skipped (requires running CLI server)');
    console.log('');

    console.log('--- Session sharing flow ---');
    console.log('  ⏭️  Skipped (requires running CLI server)');
    console.log('');

    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
