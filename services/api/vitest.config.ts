import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 10000,
        coverage: {
            reporter: ['text', 'v8'],
        },
    },
    resolve: {
        alias: {
            '@ritwikranjan/copilot-agent-framework': path.resolve(__dirname, '../../packages/stateless-copilot-sdk/src/index.ts'),
        },
    },
});
