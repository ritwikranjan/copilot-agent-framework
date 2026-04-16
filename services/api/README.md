# Copilot API Service

Internal HTTP API service that owns all Copilot interaction, session management, and audit logging. This is the central backend—both the [Teams Bot](../teams-copilot-agent/README.md) and [Web App](../web-app/README.md) delegate to this service.

For high-level architecture and deployment instructions, see the [Project Root README](../../README.md).

## Features

- **Centralized Copilot Interaction**: Single service wrapping `@ritwikranjan/copilot-agent-framework`
- **SSE Streaming**: Server-Sent Events for real-time response delivery
- **Session Management**: Full CRUD with access control and sharing
- **Audit Logging**: Tracks all interactions and tool executions in Cosmos DB
- **Pluggable Stores**: Cosmos DB for production, in-memory for local development
- **Telemetry**: Azure Monitor / OpenTelemetry integration
- **No Authentication**: Trusts VNet callers — authentication is handled by edge services

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  API Service (HTTP:4000)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Express  │  │ CopilotService│  │ SessionManager   │  │
│  │ Routes   │──│ (SDK wrapper) │  │ (lifecycle mgmt) │  │
│  │          │  └──────┬───────┘  └──────────────────┘  │
│  │ /api/chat│         │                                 │
│  │ /api/    │  ┌──────▼───────┐  ┌──────────────────┐  │
│  │ sessions │  │ CLI Server   │  │ AuditManager     │  │
│  │ /api/    │  │ (TCP:3000)   │  │ (logging)        │  │
│  │ sharing  │  └──────────────┘  └──────────────────┘  │
│  └──────────┘                                           │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Cosmos DB Stores    OR    In-Memory Stores      │    │
│  │ (SessionCosmosStore)      (InMemorySessionStore)│    │
│  │ (AuditCosmosStore)        (InMemoryAuditStore)  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## API Endpoints

### Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Send a message and receive SSE stream |

**Request Body:**
```json
{
  "message": "Hello!",
  "userInfo": { "username": "user@example.com", "hostname": "web" },
  "conversationId": "conv-123",
  "sessionId": "session-456"
}
```

**Response:** SSE stream with events:
- `delta` — incremental text content
- `reasoning` — model reasoning/thinking
- `status` — status updates
- `error` — error message
- `done` — stream complete

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions?username=X` | List user's sessions (own + shared) |
| `GET` | `/api/sessions/:id/history?username=X` | Get conversation history |
| `POST` | `/api/sessions/:id/end` | End a session |
| `POST` | `/api/sessions/:id/resume` | Reactivate an expired session |
| `PATCH` | `/api/sessions/:id/rename` | Rename a session |

### Sharing

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions/:id/share` | Share a session with another user |
| `DELETE` | `/api/sessions/:id/share/:shareId` | Revoke a share |
| `GET` | `/api/sessions/shared?username=X` | List sessions shared with user |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check endpoint |

## Quick Start

### Local Development

1. **With Docker Compose** (recommended):

   ```bash
   # From project root — starts CLI + API + Teams + Web
   docker-compose -f docker-compose.unified.yml up --build
   # API available at http://localhost:4000
   ```

2. **Standalone** (requires CLI server on port 3000):

   ```bash
   cd services/api
   npm install
   ENABLE_AUDIT=false CLI_URL=localhost:3000 npm run dev
   ```

### Test with curl

```bash
# Health check
curl http://localhost:4000/api/health

# Send a message (SSE stream)
curl -N -X POST http://localhost:4000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello!",
    "userInfo": {"username": "test@example.com", "hostname": "curl"}
  }'
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | HTTP port |
| `CLI_URL` | No | `localhost:3000` | CLI server TCP address |
| `MODEL` | No | `gpt-5.2` | Copilot model |
| `AGENT_NAME` | No | `copilot-api` | Agent identifier |
| `ENABLE_AUDIT` | No | `true` | Enable audit logging |
| `COSMOS_ENDPOINT` | When using Cosmos | - | Cosmos DB endpoint URL |
| `COSMOS_ACCOUNT_NAME` | When using Cosmos | - | Alternative to full endpoint |
| `AZURE_TENANT_ID` | When using Cosmos | - | Tenant for ManagedIdentityCredential |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | - | App Insights connection |

### Store Selection

- If `COSMOS_ENDPOINT` or `COSMOS_ACCOUNT_NAME` is set → **Cosmos DB stores**
- Otherwise → **In-memory stores** (local development)

### System Prompt & MCP Tools

The API service loads system prompt and MCP tool configuration from:
1. Mounted files: `/app/system-prompt.md`, `/app/tools-config.json`
2. Environment variables: `SYSTEM_PROMPT`, `SYSTEM_PROMPT_PATH`
3. Service defaults

In Docker Compose, agent profile files are mounted from the `agents/` directory.

## Project Structure

```
services/api/
├── src/
│   ├── index.ts                  # Express app setup, service initialization
│   ├── cosmos-stores.ts          # SessionCosmosStore & AuditCosmosStore
│   ├── sse-stream-handler.ts     # SSE response helpers
│   ├── telemetry.ts              # OpenTelemetry metrics & counters
│   ├── routes/
│   │   ├── chat.ts               # POST /api/chat (SSE streaming)
│   │   ├── sessions.ts           # Session CRUD endpoints
│   │   └── sharing.ts            # Session sharing endpoints
│   ├── routes.test.ts            # Route integration tests
│   └── sse-stream-handler.test.ts
├── Dockerfile                    # Multi-stage workspace-aware build
├── package.json
├── tsconfig.json
├── tsup.config.js
└── vitest.config.ts
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@ritwikranjan/copilot-agent-framework` | Copilot SDK wrapper, session/audit management |
| `@github/copilot-sdk` | GitHub Copilot SDK |
| `express` | HTTP framework |
| `@azure/cosmos` | Cosmos DB client |
| `@azure/identity` | ManagedIdentityCredential |
| `@azure/monitor-opentelemetry` | Azure Monitor integration |

## Testing

```bash
npm test              # Run unit tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## See Also

- [Stateless Copilot SDK](../../packages/stateless-copilot-sdk/README.md) — Core library used by this service
- [Teams Copilot Agent](../teams-copilot-agent/README.md) — Teams frontend
- [Web App](../web-app/README.md) — Browser frontend
- [CLI Server](../cli/README.md) — TCP backend this service connects to
