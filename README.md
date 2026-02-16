# Copilot CLI Server

Deploy GitHub Copilot CLI as a remote server on Azure Container Apps with an integrated Microsoft Teams bot. This provides a centralized Copilot instance accessible via Teams or programmatically via SDK.

## Architecture

The unified architecture deploys two containers in a VNet-integrated environment:

```ascii
┌─────────────────────────────────────────────────────────────────────────┐
│                        Azure Infrastructure                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌────────────────────────────────────────────┐   │
│   │     VNet     │────▶│     Container App Environment              │   │
│   │  10.0.0.0/16 │     │     (VNet integrated)                      │   │
│   └──────────────┘     │                                            │   │
│                        │  ┌──────────────┐   ┌──────────────────┐   │   │
│                        │  │ CLI Server   │◀──│ Teams Copilot    │   │   │
│   ┌──────────────┐     │  │ TCP:3000     │   │ Agent            │   │   │
│   │     ACR      │────▶│  │ (internal)   │   │ HTTP:3978        │   │   │
│   └──────────────┘     │  └──────────────┘   └────────┬─────────┘   │   │
│                        │                              │             │   │
│   ┌──────────────┐     └──────────────────────────────┼─────────────┘   │
│   │  Azure Bot   │◀───────────────────────────────────┘                 │
│   │  Service     │                                                      │
│   └──────────────┘                                                      │
│                                                                          │
│   ┌──────────────┐                                                      │
│   │  Cosmos DB   │  (Audit logs - AAD auth only)                        │
│   └──────────────┘                                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Microsoft Teams ────Bot Framework────▶ Teams Copilot Agent ──▶ CLI Server
SDK Client ─────────TCP:3000─────────▶ CLI Server (copilot --server)
```

## Features

- **Unified Deployment**: Single Bicep template deploys everything
- **Stateless Architecture**: Fully stateless design enabling high availability and horizontal scaling
- **State Persistence**:
  - **Application State**: Session metadata and mapping stored in Cosmos DB
  - **CLI State**: Shared NFS storage for Copilot CLI session persistence
- **Teams Integration**: Chat with Copilot directly in Microsoft Teams
- **Audit Logging**: All interactions stored in Cosmos DB with AAD authentication
- **Azure Bot Service**: Auto-created bot registration with managed identity
- **VNet Security**: Internal CLI server not exposed to internet
- **Horizontal Scaling**: Auto-scaling based on load for both Agent and CLI tiers
- **MCP Support**: Pre-configured with `@azure/mcp` for Azure integrations

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

```file
copilot-agent-framework/
├── packages/
│   └── stateless-copilot-sdk/             # Reusable Copilot SDK library
│       ├── src/
│       │   ├── copilot-service.ts    # CopilotService class
│       │   ├── session-manager.ts    # Session lifecycle management
│       │   ├── audit-manager.ts      # Interaction & tool logging
│       │   ├── models.ts             # Shared types & models
│       │   ├── interfaces.ts         # ISessionStore, IAuditStore
│       │   └── stores/               # In-memory implementations
│       └── README.md
├── services/
│   ├── cli/                      # CLI server implementation
│   │   └── README.md
│   └── teams-copilot-agent/      # Teams bot (uses stateless-copilot-sdk)
│       ├── src/
│       │   ├── index.ts              # Teams bot entry point
│       │   ├── copilot-service.ts    # Teams-specific wrapper
│       │   └── cosmos_integration/   # Cosmos DB store implementations
│       ├── system-prompt.md
│       ├── tools-config.json
│       └── README.md
├── agents/                       # Example custom agents
├── infra/                        # Bicep templates
├── tests/                        # Integration & E2E tests
├── Dockerfile                    # CLI server container
├── docker-compose.unified.yml    # Local development
└── README.md
```

## Documentation

- **[Copilot Core Library](packages/stateless-copilot-sdk/README.md)**: Reusable, framework-agnostic library for building services on top of the Copilot SDK. Use this to create new HTTP APIs, CLIs, or other integrations.
- **[Teams Copilot Agent](services/teams-copilot-agent/README.md)**: Teams bot service that uses stateless-copilot-sdk with Cosmos DB persistence.
- **[Copilot CLI Server](services/cli/README.md)**: TCP server running `copilot --server`.

## Configuration

### Deployment Parameters

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `baseName` | Base name for all resources | `copilot-unified` |
| `location` | Azure region | `eastus` |
| `acrName` | ACR name (required) | - |
| `acrResourceGroup` | ACR resource group | same as deployment |
| `githubToken` | GitHub PAT with Copilot | (required) |
| `createBotService` | Create Azure Bot | `true` |
| `enableAudit` | Enable Cosmos DB audit | `true` |
| `model` | Copilot model | `gpt-4.1` |

### Environment Variables (Teams Copilot Agent)

| Variable | Description |
| -------- | ----------- |
| `CLI_URL` | Internal CLI server URL |
| `BOT_ID` | Azure Bot App ID (from managed identity) |
| `AZURE_CLIENT_ID` | Managed identity client ID |
| `MODEL` | Copilot model to use |
| `ENABLE_AUDIT` | Enable audit logging |
| `COSMOS_ENDPOINT` | Cosmos DB endpoint |

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

### Integration Tests

```bash
# Requires services running locally
node tests/unified-integration-test.mjs
```

### E2E Test

```bash
# Full end-to-end with mock service
node tests/unified-e2e-test.mjs
```

### Manual Testing

Open <http://localhost:3979/devtools> in browser when running locally with `NODE_ENV=development`.

## Security

- **Managed Identity**: Bot authentication uses Azure Managed Identity (no secrets)
- **Stateless Design**: Containers are ephemeral; all state is persisted to external stores (Cosmos DB, Azure Files)
- **AAD-Only Cosmos**: No SAS keys, only AAD authentication
- **Internal CLI**: CLI server not exposed publicly
- **VNet Integration**: All traffic stays within VNet
- **Secrets**: GitHub token stored as Container App secret

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
