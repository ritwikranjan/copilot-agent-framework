import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  minify: false,
  noExternal: ['@ritwikranjan/copilot-agent-framework'],
  external: [
    '@azure/cosmos',
    '@azure/identity',
    '@github/copilot-sdk',
    'debug',
    '@microsoft/teams.api',
    '@microsoft/teams.apps',
    '@microsoft/teams.botbuilder',
    '@microsoft/teams.cards',
    '@microsoft/teams.common',
    '@microsoft/teams.dev',
    '@microsoft/teams.graph',
    '@azure/monitor-opentelemetry',
    '@opentelemetry/api'
  ]
});