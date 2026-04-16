# Teams Copilot Agent

Thin Teams Bot Framework frontend that delegates all Copilot interaction to the internal [API Service](../api/README.md). Built with [`@microsoft/teams.apps`](https://www.npmjs.com/package/@microsoft/teams.apps) modular SDKs.

For high-level architecture and deployment instructions, see the [Project Root README](../../README.md).

## Features

- **Thin Proxy**: Delegates all Copilot interaction to the internal API service
- **Streaming**: Adapts SSE responses from the API into Teams `IStreamer` interface
- **Slash Commands**: `/help`, `/status`, `/new-session`, `/end-session`, `/resume`, `/queries`
- **Managed Identity**: Bot Framework auth via `ManagedIdentityCredential`
- **DevTools Support**: Local development with Teams DevTools plugin
- **Telemetry**: OpenTelemetry metrics for throttle events, message latency, session lifecycle

## Architecture

This service is a thin Teams-specific adapter on top of the internal API service:

```
Teams Message
    ↓
  index.ts (command dispatch)
    ↓
  copilot-service.ts (API call wrapper)
    ↓
  api-client.ts (fetch with retry)
    ↓
  Internal API Service (SSE stream)
    ↓
  sse-to-teams.ts (adapt to IStreamer)
    ↓
  Teams Chat (streamed response)
```

- **`index.ts`** — Teams bot entry point, activity handler, command dispatch
- **`copilot-service.ts`** — Wraps API client calls, backward-compatible module-level API
- **`api-client.ts`** — HTTP client for internal API service with retry logic
- **`sse-to-teams.ts`** — Converts SSE streaming events to Teams `IStreamer` interface
- **`commands.ts`** — Command definitions, parsing, and help text
- **`telemetry.ts`** — OpenTelemetry metrics and counters

## Session Management

The service uses a **stateless** design pattern — all session state is managed by the API service:

1. **API Service** owns session creation, lookup, and persistence in Cosmos DB.
2. **Teams Bot** passes `conversationId` with each message; the API maps it to a session.
3. **Resume**: Any container instance can resume a conversation by calling the API.
4. **Cleanup**: Sessions expire via TTL managed by the API service.

## Quick Start

### Local Development

1. **Copy environment file**:

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Run with Docker Compose** (recommended):

   ```bash
   # From project root
   docker-compose -f docker-compose.unified.yml up --build
   ```

4. **Open DevTools**:
   - Navigate to <http://localhost:3978/devtools>
   - Send test messages through the interface

### Manual Local Run

1. **Start the Copilot CLI Server**:

   ```bash
   # In project root
   docker-compose -f docker-compose.test.yml up copilot-cli-server
   ```

2. **Run the Agent**:

   ```bash
   cd services/teams-copilot-agent
   npm run dev
   ```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `API_URL` | Yes | `http://api-service:4000` | Internal API service URL |
| `PORT` | No | `3978` | HTTP port for the bot |
| `BOT_ID` | Production | - | Microsoft Bot Framework App ID |
| `AZURE_CLIENT_ID` | Production | - | Managed Identity Client ID |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | - | Logging verbosity |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | - | App Insights telemetry |

### System Prompt

The system prompt can be configured in several ways:

1. **Environment variable**: Set `SYSTEM_PROMPT` with the prompt text
2. **Environment path**: Set `SYSTEM_PROMPT_PATH` to a file path
3. **Mounted file**: Mount a file to `/app/system-prompt.md`
4. **Local file**: Place `system-prompt.md` in the service directory

### MCP Tools Configuration

Create a `tools-config.json` file:

```json
{
  "mcp_servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "tools": ["*"]
    }
  }
}
```

## Deployment

See the [Unified Deployment Guide](../../README.md#deploy) in the project root.

## Project Structure

```
services/teams-copilot-agent/
├── src/
│   ├── index.ts              # Main entry point (Teams bot)
│   ├── copilot-service.ts    # API client wrapper + backward-compat API
│   ├── api-client.ts         # HTTP client for internal API (fetch + retry)
│   ├── sse-to-teams.ts       # SSE → Teams IStreamer adapter
│   ├── commands.ts           # Slash command handling
│   └── telemetry.ts          # OpenTelemetry metrics
├── Dockerfile                # Multi-stage workspace-aware build
├── package.json
├── tsconfig.json
├── tsup.config.js
├── vitest.config.ts
├── system-prompt.md          # Default system prompt (fallback)
├── tools-config.json         # Default MCP tools config (fallback)
└── .env.example
```

> **Note:** Session management, audit logging, and Copilot SDK interaction are handled by the [API Service](../api/README.md). The Teams agent is a thin adapter.

## Testing

### Unit Tests

```bash
npm test
```

### Local Integration Test

1. Start with docker-compose
2. Open DevTools at <http://localhost:3978/devtools>
3. Send test messages

### Production Health Check

```bash
curl https://your-agent.azurecontainerapps.io/health
```

## Differences from Previous Architecture

| Aspect | Old (2 Services) | Current (4 Services) |
| ------ | ---------------- | -------------------- |
| Architecture | CLI → Teams Agent (direct SDK) | CLI → API → Teams Agent / Web App |
| Session Management | In Teams Agent (Cosmos) | Centralized in API Service |
| Authentication | MSI only | MSI (Teams) + Entra ID (Web) |
| Deployments | 2 containers | 4 containers |
| API Layer | Direct SDK calls | HTTP REST via API Service |
| Frontend | Teams only | Teams + Web App |

## Migration Notes

If migrating from the old architecture:

1. **Bot Registration**: Update the messaging endpoint to the new URL
2. **Managed Identity**: The new MSI Client ID must be registered with Bot Framework
3. **Cosmos DB**: Use the same database or migrate data as needed
4. **Environment**: Update deployment scripts to use `deploy-unified.ps1`

## Contributing

See the main project README for contribution guidelines.
