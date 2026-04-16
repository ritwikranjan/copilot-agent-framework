# Copilot Agent Framework

Framework for building stateless GitHub Copilot agents at scale — with session management, audit logging, and pluggable persistence. Deploy to Azure Container Apps with integrated Microsoft Teams bot and web chat UI.

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Configuration](#configuration)
- [Testing](#testing)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Architecture

The 4-service architecture deploys four containers in a VNet-integrated environment:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Azure Infrastructure                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐     ┌─────────────────────────────────────────────────┐  │
│   │     VNet     │────▶│        Container App Environment                │  │
│   │  10.0.0.0/16 │     │        (VNet integrated)                        │  │
│   └──────────────┘     │                                                 │  │
│                        │   ┌──────────────┐   ┌───────────────────────┐  │  │
│   ┌──────────────┐     │   │ CLI Server   │◀──│ API Service           │  │  │
│   │     ACR      │────▶│   │ TCP:3000     │   │ HTTP:4000             │  │  │
│   │              │     │   │ (internal)   │   │ (internal)            │  │  │
│   └──────────────┘     │   └──────────────┘   └──┬────────────────┬───┘  │  │
│                        │                         │                │      │  │
│                        │   ┌─────────────────────▼──┐  ┌─────────▼───┐  │  │
│                        │   │ Teams Copilot Agent    │  │  Web App    │  │  │
│                        │   │ HTTP:3978 (external)   │  │  HTTP:3001  │  │  │
│                        │   └───────────┬────────────┘  │  (external) │  │  │
│                        │               │               └─────────────┘  │  │
│                        └───────────────┼────────────────────────────────┘  │
│                                        │                                   │
│   ┌──────────────┐                     │       ┌──────────────┐           │
│   │  Azure Bot   │◀───────────────────-┘       │  Cosmos DB   │           │
│   │  Service     │                              │  (AAD auth)  │           │
│   └──────────────┘                              └──────────────┘           │
│                                                                            │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐           │
│   │  NFS Storage │      │ App Insights │      │  Key Vault   │           │
│   └──────────────┘      └──────────────┘      └──────────────┘           │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘

Microsoft Teams ─── Bot Framework ──▶ Teams Agent ──▶ API Service ──▶ CLI Server
Web Browser ─────── Entra ID Auth ──▶ Web App ──────▶ API Service ──▶ CLI Server
```

## Features

- **4-Service Architecture**: CLI Server, API Service, Teams Bot, and Web App — each independently scalable
- **Stateless Design**: Fully stateless services enabling horizontal scaling via external state stores
- **Multi-Platform Access**: Chat with Copilot via Microsoft Teams or the web chat UI
- **Session Management**: Create, resume, rename, and share sessions across platforms
- **Audit Logging**: All interactions and tool executions stored in Cosmos DB
- **State Persistence**:
  - **Application State**: Session metadata, sharing, and audit data in Cosmos DB
  - **CLI State**: Shared NFS storage for Copilot CLI session files
- **Authentication**: Microsoft Entra ID for web app, Managed Identity for Azure services
- **Azure Bot Service**: Auto-provisioned bot registration with managed identity
- **VNet Security**: Internal services (CLI, API) not exposed to internet
- **Agent Profiles**: Customizable personas via `agents/` directory (system prompts + MCP tools)
- **MCP Support**: Pre-configured `@azure/mcp` with per-agent tool configuration
- **Observability**: Azure Monitor / OpenTelemetry integration across all services

## Quick Start

### Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) (`az`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [GitHub PAT](https://github.com/settings/tokens) with Copilot access
- Azure subscription with Container Apps support

### Deploy

```powershell
# Clone and navigate to the project
cd copilot-agent-framework

# Login to Azure
az login

# Deploy unified infrastructure (creates everything including Azure Bot)
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -AcrResourceGroup "acr-rg" `
    -GithubToken "ghp_your_github_pat"
```

### Local Development with Docker Compose

```bash
# Start locally (requires GITHUB_TOKEN in .env)
docker-compose -f docker-compose.unified.yml up -d

# Run tests
node tests/unified-integration-test.mjs
node tests/unified-e2e-test.mjs

# View logs
docker-compose -f docker-compose.unified.yml logs -f teams-copilot-agent
```

## Project Structure

```
copilot-agent-framework/
├── packages/
│   └── stateless-copilot-sdk/        # Reusable Copilot SDK library (npm package)
├── services/
│   ├── cli/                           # Copilot CLI TCP server
│   ├── api/                           # Internal HTTP API service (Express)
│   ├── teams-copilot-agent/           # Teams bot frontend
│   └── web-app/                       # Next.js web chat UI
├── agents/                            # Agent profiles (system prompts + MCP tools)
├── infra/                             # Bicep IaC templates
├── scripts/                           # PowerShell deployment scripts
├── tests/                             # Integration & E2E tests
├── docker-compose.unified.yml         # Local development (all 4 services)
└── docker-compose.test.yml            # Legacy local development
```

## Documentation

| Component | Description | README |
|-----------|-------------|--------|
| **Copilot SDK Library** | Framework-agnostic library with session management, audit logging, streaming | [packages/stateless-copilot-sdk/](packages/stateless-copilot-sdk/README.md) |
| **API Service** | Internal HTTP API — owns session, audit, and Copilot interaction | [services/api/](services/api/README.md) |
| **Teams Copilot Agent** | Thin Teams bot that delegates to the API service | [services/teams-copilot-agent/](services/teams-copilot-agent/README.md) |
| **Web App** | Next.js chat UI with Microsoft Entra ID authentication | [services/web-app/](services/web-app/README.md) |
| **CLI Server** | TCP server running `copilot --server` with Azure MCP | [services/cli/](services/cli/README.md) |
| **Agent Profiles** | Customizable agent personas (system prompts + tools) | [agents/](agents/README.md) |
| **Infrastructure** | Bicep templates for Azure deployment | [infra/](infra/README.md) |
| **Scripts** | PowerShell deployment & build scripts | [scripts/](scripts/README.md) |
| **Tests** | Integration and E2E test suites | [tests/](tests/README.md) |

## Configuration

### Deployment Parameters

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `baseName` | Base name for all resources | `copilot-unified` |
| `location` | Azure region | `eastus` |
| `acrName` | ACR name (required) | - |
| `acrResourceGroup` | ACR resource group | same as deployment |
| `githubToken` | GitHub PAT with Copilot | (required) |
| `azureTenantId` | Azure Tenant ID | (required) |
| `entraClientId` | Entra ID Client ID for web app auth | - |
| `createBotService` | Create Azure Bot | `true` |
| `cosmosServerless` | Serverless Cosmos DB | `true` |
| `enableSessionStorage` | NFS for CLI session persistence | `true` |
| `model` | Copilot model | `gpt-5.2` |
| `cliMinReplicas` / `cliMaxReplicas` | CLI server autoscale | `1` / `3` |
| `agentMinReplicas` / `agentMaxReplicas` | Agent autoscale | `1` / `3` |

### Environment Variables (Teams Copilot Agent)

| Variable | Description |
| -------- | ----------- |
| `API_URL` | Internal API service URL (e.g., `http://api-service:4000`) |
| `PORT` | HTTP port (default: `3978`) |
| `BOT_ID` | Azure Bot App ID (from managed identity) |
| `AZURE_CLIENT_ID` | Managed identity client ID |
| `NODE_ENV` | Environment mode (`development` / `production`) |

### Environment Variables (API Service)

| Variable | Description |
| -------- | ----------- |
| `CLI_URL` | CLI server address (e.g., `localhost:3000`) |
| `PORT` | HTTP port (default: `4000`) |
| `MODEL` | Copilot model to use |
| `ENABLE_AUDIT` | Enable audit logging (`true` / `false`) |
| `COSMOS_ENDPOINT` | Cosmos DB endpoint (enables Cosmos stores) |

### Environment Variables (Web App)

| Variable | Description |
| -------- | ----------- |
| `API_URL` | Internal API service URL |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | Entra ID app registration client ID |
| `NEXT_PUBLIC_ENTRA_TENANT_ID` | Azure tenant ID |
| `NEXT_PUBLIC_REDIRECT_URI` | OAuth redirect URI |

## Teams Bot Setup

After deployment, create a Teams app manifest:

1. Get deployment outputs:

   ```powershell
   az deployment group show -g copilot-unified-rg -n main --query properties.outputs
   ```

2. Create `manifest.json`:

   ```json
   {
     "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
     "manifestVersion": "1.17",
     "version": "1.0.0",
     "id": "<Bot ID from outputs>",
     "developer": { ... },
     "name": { "short": "Copilot Agent" },
     "bots": [{
       "botId": "<Bot ID from outputs>",
       "scopes": ["personal", "team", "groupChat"]
     }],
     "validDomains": ["<Agent FQDN from outputs>"]
   }
   ```

3. Package and upload to Teams Admin Center

## Customization

### System Prompt

Edit `services/teams-copilot-agent/system-prompt.md` to customize the bot's behavior and personality.

### Creating Custom Agents

See `agents/README.md` for instructions on creating specialized agents for different use cases.

## Testing

### Unit Tests

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

```bash
# Requires docker-compose services running
node tests/unified-integration-test.mjs    # Health checks + message flow
node tests/api-integration-test.mjs        # API endpoints
node tests/web-app-integration-test.mjs    # Web app routes
```

### E2E Tests

```bash
node tests/unified-e2e-test.mjs           # Full flow with mock Bot Framework
```

### Manual Testing

- **Web App**: Open <http://localhost:3001> in browser
- **DevTools**: Open <http://localhost:3979/devtools> (requires `NODE_ENV=development`)

See [tests/README.md](tests/README.md) for detailed test documentation.

## Security

- **Managed Identity**: Bot and service authentication via Azure Managed Identity (no secrets)
- **Entra ID Auth**: Web app uses Microsoft Entra ID with PKCE for user authentication
- **AAD-Only Cosmos**: No SAS keys — `disableLocalAuth: true`
- **Internal Services**: CLI server and API service are VNet-internal only
- **VNet Integration**: All inter-service traffic stays within the VNet
- **Secrets Management**: GitHub token stored as Container App secret

## Troubleshooting

### Bot not responding

1. Check agent logs: `az containerapp logs show -n copilot-unified-agent -g copilot-unified-rg`
2. Verify CLI server is healthy: Check container app status
3. Ensure Bot Framework registration is correct

### Cosmos DB access denied

1. Verify managed identity has Cosmos DB Data Contributor role
2. Check RBAC role assignment in portal

### Container deployment fails

1. Check ACR credentials are correct
2. Verify images exist in ACR
3. Check VNet subnet delegation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test locally with Docker Compose
4. Submit a pull request

See `.github/copilot-instructions.md` for AI assistant guidelines.

## License

MIT
