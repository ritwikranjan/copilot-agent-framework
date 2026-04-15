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
  external: [
    '@azure/identity',
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