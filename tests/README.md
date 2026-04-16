# Tests

Integration and end-to-end tests for the Copilot Agent Framework. These tests validate the full service stack running in Docker Compose or Azure Container Apps.

## Test Categories

### Unit Tests (per-service)

Each service has co-located unit tests using [Vitest](https://vitest.dev/):

```bash
# SDK library
cd packages/stateless-copilot-sdk && npm test

# API service
cd services/api && npm test

# Teams agent
cd services/teams-copilot-agent && npm test

# Web app
cd services/web-app && npm test
```

### Integration Tests

Require services running locally via Docker Compose:

```bash
docker-compose -f docker-compose.unified.yml up -d
```

| Test File | Description | What It Validates |
|-----------|-------------|-------------------|
| `unified-integration-test.mjs` | Full-stack integration | CLI, API, Teams, Web health checks; message flow across services |
| `api-integration-test.mjs` | API service endpoints | REST API routes, SSE streaming, session CRUD |
| `web-app-integration-test.mjs` | Web app routes | Next.js pages, API proxy routes, auth flow |
| `sdk-integration-test.mjs` | SDK library | CopilotService wrapper, session management, audit logging |
| `integration-test.mjs` | Legacy integration | Older test suite (pre-unified architecture) |
| `local-test.mjs` | Quick dev check | Fast local verification during development |

### End-to-End Tests

| Test File | Description | What It Validates |
|-----------|-------------|-------------------|
| `unified-e2e-test.mjs` | Full E2E flow | Mock Bot Framework service, real message flow through all services |
| `cross-platform-e2e-test.mjs` | Cross-platform | Tests Teams and web app paths in parallel |

### Cloud Tests

| File | Description |
|------|-------------|
| `Dockerfile.test-client` | Container for running tests in Azure |
| `run-tests.mjs` | Test runner script for cloud execution |

## Running Tests

### Local (Docker Compose)

```bash
# 1. Start all services
docker-compose -f docker-compose.unified.yml up -d

# 2. Wait for services to be healthy
docker-compose -f docker-compose.unified.yml ps

# 3. Run integration tests
node tests/unified-integration-test.mjs

# 4. Run E2E tests
node tests/unified-e2e-test.mjs
```

### Cloud (Azure Container Apps)

```powershell
# Trigger test execution in the deployed test client container
.\scripts\run-tests.ps1 -ResourceGroupName "copilot-unified-rg" -Follow
```

## Service Ports (Local)

| Service | Port | Health Check |
|---------|------|-------------|
| CLI Server | `3000` | `nc -z localhost 3000` |
| API Service | `4000` | `GET /api/health` |
| Teams Agent | `3978` | `GET /` |
| DevTools | `3979` | `GET /devtools` |
| Web App | `3001` | `GET /` |

## Writing New Tests

Tests are plain Node.js ESM scripts (`.mjs`). Use the native `fetch` API and `assert` module:

```javascript
import assert from 'node:assert';

const API_URL = process.env.API_URL || 'http://localhost:4000';

// Health check
const res = await fetch(`${API_URL}/api/health`);
assert.strictEqual(res.status, 200, 'API service should be healthy');

console.log('✅ Test passed');
```

## See Also

- [scripts/README.md](../scripts/README.md) — Deployment and test execution scripts
- [Docker Compose](../docker-compose.unified.yml) — Local service orchestration
