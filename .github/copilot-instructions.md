# Copilot CLI Server - AI Assistant Instructions

This file provides guidelines for AI assistants (like GitHub Copilot) working on this codebase.

## Project Overview

This project deploys GitHub Copilot CLI as a remote TCP server on Azure Container Apps with an integrated Microsoft Teams bot (Teams Copilot Agent). The unified architecture provides:

1. **CLI Server**: Raw TCP server running `copilot --server` for SDK clients
2. **Teams Copilot Agent**: TypeScript Teams bot that connects to the CLI server
3. **Stateless Copilot SDK**: Framework-agnostic library wrapping `@github/copilot-sdk` with externalized session/audit state
4. **Agent Profiles**: Customizable agent personas via `agents/` directory (system prompts + MCP tools)
5. **Audit System**: Cosmos DB-backed logging with AAD authentication
6. **Azure Bot Service**: Auto-provisioned bot registration with managed identity

### Key Technologies
- **Runtime**: Node.js 24+ (CLI), Node.js 22+ (Agent)
- **Teams Bot**: `@microsoft/teams.apps` modular SDKs
- **SDK Library**: `@ritwikranjan/copilot-agent-framework` (workspace package)
- **Container**: Docker with Alpine Linux / Debian Slim
- **Infrastructure**: Azure Container Apps with TCP/HTTP ingress
- **IaC**: Bicep templates
- **Scripts**: PowerShell for deployment
- **Database**: Azure Cosmos DB (AAD-only, no SAS keys)
- **MCP**: `@azure/mcp` installed on CLI server

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Azure Container Apps Environment             │
│                                                             │
│  ┌─────────────────┐      ┌────────────────────────────┐   │
│  │   CLI Server    │◀─────│   Teams Copilot Agent      │   │
│  │   TCP:3000      │      │   HTTP:3978                │   │
│  │   (internal)    │      │   (external)               │   │
│  └─────────────────┘      └──────────┬─────────────────┘   │
│                                      │                      │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                          ┌────────────▼────────────┐
                          │    Azure Bot Service    │
                          │    (Managed Identity)   │
                          └─────────────────────────┘
```

## Directory Structure

```
copilot-agent-framework/
├── packages/
│   └── stateless-copilot-sdk/       # Framework-agnostic Copilot SDK wrapper
│       ├── src/
│       │   ├── index.ts             # Public API barrel export
│       │   ├── copilot-service.ts   # CopilotService class
│       │   ├── session-manager.ts   # Stateless session lifecycle
│       │   ├── audit-manager.ts     # Interaction & tool logging
│       │   ├── models.ts            # Shared types, models & factory functions
│       │   ├── interfaces.ts        # ISessionStore, IAuditStore
│       │   ├── logger.ts            # ILogger interface & debug-based default
│       │   ├── stores/              # In-memory test implementations
│       │   └── *.test.ts            # Co-located unit tests (vitest)
│       ├── package.json
│       ├── CHANGELOG.md
│       └── README.md
├── services/
│   ├── cli/                         # CLI Server service
│   │   ├── Dockerfile
│   │   └── scripts/                 # Entrypoint and MCP wrappers
│   └── teams-copilot-agent/         # Teams bot service (main service)
│       ├── src/
│       │   ├── index.ts             # Entry point (Teams bot)
│       │   ├── copilot-service.ts   # Teams IStreamer → IStreamHandler adapter
│       │   ├── commands.ts          # Slash command handling
│       │   └── cosmos_integration/  # Cosmos DB persistence layer
│       │       ├── index.ts         # Re-exports + singleton factories
│       │       ├── db.ts            # SessionCosmosStore + AuditCosmosStore
│       │       └── mock-data-store.ts
│       ├── Dockerfile               # Multi-stage (workspace-aware)
│       ├── system-prompt.md         # Default system prompt
│       ├── tools-config.json        # Default MCP configuration
│       └── README.md
├── agents/                          # Agent profiles (system prompts + tools)
│   ├── code-reviewer/
│   │   └── system-prompt.md
│   ├── writing-assistant/
│   │   └── system-prompt.md
│   └── README.md
├── infra/
│   ├── main.bicep                   # Main deployment template
│   └── modules/
│       ├── teams-copilot-agent.bicep
│       ├── bot-service.bicep
│       ├── cosmos-db.bicep
│       ├── container-app.bicep      # CLI server (TCP)
│       ├── container-app-env.bicep  # Container Apps environment
│       ├── vnet.bicep               # VNet with storage service endpoint
│       ├── nfs-storage.bicep        # NFS Azure Files for CLI session persistence
│       ├── private-dns-zone.bicep   # Private DNS for NFS endpoint
│       ├── dns-a-record.bicep
│       ├── teams-bot.bicep
│       ├── api-service.bicep
│       └── test-client.bicep
├── scripts/
│   └── deploy-unified.ps1           # Unified deployment script
├── tests/
│   ├── unified-integration-test.mjs
│   └── unified-e2e-test.mjs
├── .dockerignore
└── docker-compose.unified.yml       # Local development
```

## Key Design Decisions

### Why Unified Architecture?
Previously three separate services (CLI server, base-api, teams-bot), now consolidated into two containers:
- Simpler deployment (single Bicep template)
- Reduced network hops
- Easier debugging
- Lower Azure costs

### Why Stateless Copilot SDK as a Separate Package?
- **Framework-agnostic**: No Azure or Teams dependencies in the library
- **Horizontal scaling**: All session state externalized via `ISessionStore` / `IAuditStore`
- **Configurable session expiration**: Default 12 hours, override via `SessionManagerOptions.sessionExpirationMs`
- **Pluggable logging**: `ILogger` interface with `debug`-based default (silent unless `DEBUG=copilot:*`)
- **Testable**: In-memory stores for unit tests; Cosmos DB stores for production
- **Reusable**: Can build HTTP APIs, CLIs, or other integrations on top
- **Split stores**: `SessionCosmosStore` and `AuditCosmosStore` are separate classes (SRP)
  - Sessions partitioned by `/user_info/username`
  - Interactions and tool executions partitioned by `/session_id`

### Why NFS for CLI Session Storage?
- The Copilot CLI server (`copilot --server`) persists session state to the filesystem at `/root/.copilot/session-state`
- The SDK does **not** expose a pluggable storage interface for this — it's hardcoded to filesystem
- Without shared storage, `resumeSession()` fails when a different container handles the next request
- **Solution**: Mount Azure Files (NFS protocol) to all container replicas via `nfs-storage.bicep`
- This creates a **two-tier persistence** architecture:
  - **Tier 1 (Application)**: Session metadata + audit → Cosmos DB (via `ISessionStore`/`IAuditStore`)
  - **Tier 2 (CLI Server)**: Copilot SDK session files → NFS mount (shared filesystem)
- NFS is secured via private endpoint within the VNet

### Why Managed Identity for Bot?
- No secrets to manage
- Automatic credential rotation
- Azure RBAC for Cosmos DB access
- Compliant with security policies (no SAS keys)

### Why Cosmos DB with AAD-only?
- Policy compliance (disableLocalAuth: true)
- No key management
- Audit trail with managed identity

### Why VNet Integration?
- CLI server stays internal (not exposed to internet)
- Secure communication between containers
- Required for TCP ingress support

## Development Workflow

### Local Development
```bash
# Start services locally
docker-compose -f docker-compose.unified.yml up -d

# Run integration tests
node tests/unified-integration-test.mjs

# Run E2E test
node tests/unified-e2e-test.mjs

# Test with DevTools (browser)
open http://localhost:3979/devtools
```

### Making Changes to Teams Copilot Agent

1. Edit files in `services/teams-copilot-agent/src/`
2. Run tests: `cd services/teams-copilot-agent && npm test`
3. Rebuild: `docker-compose -f docker-compose.unified.yml up -d --build`
4. Test locally with DevTools

### Customizing the System Prompt

System prompts can be customized at multiple levels:

1. **Agent profiles**: Create `agents/<profile>/system-prompt.md` and deploy with `-AgentProfile`
2. **Service default**: Edit `services/teams-copilot-agent/system-prompt.md`
3. **Runtime override**: Set `SYSTEM_PROMPT` env var or `SYSTEM_PROMPT_PATH`

### Creating a New Agent Profile

1. Create a directory under `agents/` (e.g., `agents/my-agent/`)
2. Add `system-prompt.md` with the agent's instructions
3. Optionally add `tools-config.json` for MCP tools
4. Deploy with: `docker build --build-arg AGENT_PROFILE=my-agent ...`
5. Or via script: `.\scripts\deploy-unified.ps1 ... -AgentProfile "my-agent"`

### Adding MCP Tools

1. Create `tools-config.json` in teams-copilot-agent
2. Define tool schemas and implementations
3. Tools are automatically exposed to Copilot

## Bicep Patterns

### Module Structure
- All resources in `infra/modules/`
- Main template: `infra/main.bicep`
- Use `@description` decorators on all parameters/outputs
- Export useful outputs for script consumption

### Key Modules
- `vnet.bicep` - VNet with /16 CIDR, /23 subnet, storage service endpoint
- `container-app-env.bicep` - Container Apps environment with NFS storage registration
- `container-app.bicep` - CLI server (TCP) with NFS volume mount
- `teams-copilot-agent.bicep` - Teams bot (HTTP)
- `bot-service.bicep` - Azure Bot Service
- `cosmos-db.bicep` - Audit database
- `nfs-storage.bicep` - Premium FileStorage with NFS share and private endpoint

## Testing

### Unit Tests (SDK)
```bash
cd packages/stateless-copilot-sdk
npm test
```

### Unit Tests (Teams Agent)
```bash
cd services/teams-copilot-agent
npm test
```

### Integration Tests
```bash
# Requires docker-compose running
node tests/unified-integration-test.mjs
```

### E2E Tests
```bash
# Full flow with mock Bot Framework service
node tests/unified-e2e-test.mjs
```

## Deployment

### Deploy to Azure
```powershell
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -AcrResourceGroup "acr-rg" `
    -GithubToken "ghp_xxx"
```

### Skip Docker Build (use existing images)
```powershell
.\scripts\deploy-unified.ps1 ... -SkipBuild
```

## Do's and Don'ts

### Do
- ✅ Keep services/teams-copilot-agent as the main service
- ✅ Use managed identity for Azure authentication
- ✅ Test locally with docker-compose before deploying
- ✅ Update tests when changing functionality
- ✅ Keep audit system modular and testable
- ✅ Use TypeScript strict mode
- ✅ Use `noExternal` in tsup for workspace packages (stateless-copilot-sdk)
- ✅ Keep `ISessionStore` and `IAuditStore` as separate interfaces
- ✅ Use agent profiles for custom agent personas

### Don't
- ❌ Add SAS keys to Cosmos DB (policy violation)
- ❌ Expose CLI server externally
- ❌ Store secrets in code
- ❌ Use Node.js < 22
- ❌ Create separate API services (use teams-copilot-agent)
- ❌ Use the deprecated `IAuditDataStore` combined interface in new code
- ❌ Add stateless-copilot-sdk to tsup `external` list (it must be bundled)

## Troubleshooting

### Bot not responding
1. Check container logs in Azure Portal
2. Verify CLI server is healthy (internal health check)
3. Check Bot Framework registration

### Cosmos DB access denied
1. Verify managed identity has "Cosmos DB Built-in Data Contributor" role
2. Check RBAC assignment in portal

### Local development issues
1. Ensure ports 3000, 3978, 3979 are free
2. Check GITHUB_TOKEN in .env file
3. Verify Docker Desktop is running

## Related Files

- `services/teams-copilot-agent/README.md` - Detailed service docs
- `packages/stateless-copilot-sdk/README.md` - SDK library API docs
- `agents/README.md` - Creating custom agents

## Contact

For questions, check commit history or open an issue.