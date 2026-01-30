# Teams Copilot Agent

Unified Teams Bot service with direct GitHub Copilot SDK integration. This service uses the [`@copilot-cli-server/stateless-copilot-sdk`](../../packages/stateless-copilot-sdk/README.md) library for all Copilot SDK interaction, session management, and audit logging — adding Teams-specific bot framework integration and Cosmos DB persistence on top.

For high-level architecture and deployment instructions, see the [Project Root README](../../README.md).

## Features

- **Stateless Architecture**: Designed for horizontal scaling with session state persisted to Cosmos DB
- **Direct SDK Integration**: Uses `@copilot-cli-server/stateless-copilot-sdk` which wraps `@github/copilot-sdk`
- **Audit Logging**: Session tracking, interaction logging, and tool execution monitoring via Cosmos DB
- **MCP Tools Support**: Configurable MCP servers for extended tool capabilities
- **DevTools Support**: Local development with Teams DevTools plugin

## Architecture

This service is a thin Teams-specific layer on top of `stateless-copilot-sdk`:

```
┌─────────────────────────────────────────────────┐
│               teams-copilot-agent               │
│                                                 │
│  ┌───────────────┐   ┌───────────────────────┐  │
│  │   index.ts    │──▶│   copilot-service.ts   │  │
│  │ (Teams Bot)   │   │ (Teams IStreamer →      │  │
│  │               │   │  IStreamHandler adapter)│  │
│  └───────────────┘   └───────────┬────────────┘  │
│                                  │               │
│  ┌───────────────────────────────▼────────────┐  │
│  │  cosmos_integration/db.ts                      │  │
│  │  SessionCosmosStore (ISessionStore)             │  │
│  │  AuditCosmosStore   (IAuditStore)               │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
├──────────────────────────────────────────────────┤
│           @copilot-cli-server/stateless-copilot-sdk       │
│                                                  │
│  CopilotService · SessionManager · AuditManager  │
│  Models · Interfaces · In-Memory Stores          │
└──────────────────────────────────────────────────┘
```

- **`copilot-service.ts`** — Wraps the library's `CopilotService` class, adapting Teams `IStreamer` to the generic `IStreamHandler` interface
- **`cosmos_integration/db.ts`** — `SessionCosmosStore` (ISessionStore) and `AuditCosmosStore` (IAuditStore), sharing a `CosmosClientBase` for auth
- **`cosmos_integration/index.ts`** — Re-exports library types + provides singleton factories backed by Cosmos DB

## Session Management

The service uses a **stateless** design pattern:

1. **Cosmos DB** acts as the single source of truth for session state.
2. **Metadata Storage**: `conversationId` (Teams) is mapped to `sessionId` (Copilot SDK).
3. **Resume Capability**: Any container instance can resume a conversation by looking up the session ID.
4. **Cleanup**: Expired sessions are automatically managed via TTL or lazy cleanup.

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
| `CLI_URL` | Yes | `localhost:3000` | Copilot CLI Server URL (host:port) |
| `PORT` | No | `3978` | HTTP port for the bot |
| `BOT_ID` | Production | - | Microsoft Bot Framework App ID |
| `AZURE_CLIENT_ID` | Production | - | Managed Identity Client ID |
| `MODEL` | No | `gpt-4.1` | Copilot model to use |
| `AGENT_NAME` | No | `teams-copilot-agent` | Agent identifier |
| `ENABLE_AUDIT` | No | `true` | Enable/disable audit logging |
| `COSMOS_ENDPOINT` | When audit enabled | - | Cosmos DB endpoint URL |
| `COSMOS_DATABASE_NAME` | No | `AuditDB` | Cosmos DB database name |
| `NODE_ENV` | No | `development` | Environment mode |

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

```file
services/teams-copilot-agent/
├── src/
│   ├── index.ts              # Main entry point (Teams bot)
│   ├── copilot-service.ts    # Teams adapter (wraps stateless-copilot-sdk)
│   ├── commands.ts           # Slash command handling
│   └── cosmos_integration/   # Persistence layer
│       ├── index.ts          # Re-exports from stateless-copilot-sdk + singletons
│       ├── db.ts             # SessionCosmosStore + AuditCosmosStore (split SRP)
│       └── mock-data-store.ts # In-memory mock for testing
├── Dockerfile                # Multi-stage workspace-aware build
├── package.json
├── tsconfig.json
├── tsup.config.js            # noExternal bundles stateless-copilot-sdk
├── vitest.config.ts
├── system-prompt.md          # Default system prompt
├── tools-config.json         # Default MCP tools config
└── .env.example
```

> **Note:** Most types, interfaces, and core logic live in [`@copilot-cli-server/stateless-copilot-sdk`](../../packages/stateless-copilot-sdk/README.md). The `cosmos_integration/` files are thin re-exports plus the Cosmos DB implementations.

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

## Differences from Separate Services

| Aspect | Old (3 Services) | New (Unified) |
| ------ | ---------------- | ------------- |
| Architecture | CLI → API → Teams Bot | CLI → Teams Agent |
| Authentication | JWT + MSI | MSI only |
| Deployments | 3 containers | 2 containers |
| API Layer | HTTP REST | Direct SDK calls |
| Latency | Higher (extra hop) | Lower |
| Complexity | Higher | Lower |

## Migration Notes

If migrating from the old architecture:

1. **Bot Registration**: Update the messaging endpoint to the new URL
2. **Managed Identity**: The new MSI Client ID must be registered with Bot Framework
3. **Cosmos DB**: Use the same database or migrate data as needed
4. **Environment**: Update deployment scripts to use `deploy-unified.ps1`

## Contributing

See the main project README for contribution guidelines.
