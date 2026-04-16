# Infrastructure

Azure Bicep templates for deploying the Copilot Agent Framework. Deploys a complete 4-service architecture to Azure Container Apps with VNet integration, Cosmos DB, Bot Service, and monitoring.

For high-level architecture, see the [Project Root README](../README.md).

## Deployment

### Prerequisites

- Azure CLI (`az`) with Bicep extension
- Azure subscription with Container Apps support
- Existing Azure Container Registry (ACR) with built images

### Deploy via Script (Recommended)

```powershell
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -AcrResourceGroup "acr-rg" `
    -GithubToken "ghp_xxx"
```

See [scripts/README.md](../scripts/README.md) for full parameter documentation.

### Deploy via Azure CLI

```bash
az deployment group create \
  --resource-group copilot-unified-rg \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters acrName=myacr githubToken=ghp_xxx azureTenantId=xxx
```

## Template Structure

### Entry Point

| File | Description |
|------|-------------|
| `main.bicep` | Main orchestrator — references all modules, defines parameters and outputs |
| `main.bicepparam` | Default parameter values |

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseName` | string | `copilot-unified` | Prefix for all resource names |
| `location` | string | (resource group) | Azure region |
| `acrName` | string | (required) | Container Registry name |
| `acrResourceGroup` | string | (current RG) | ACR resource group |
| `githubToken` | secure string | (required) | GitHub PAT with Copilot access |
| `azureTenantId` | string | (required) | Azure tenant ID |
| `entraClientId` | string | - | Entra ID client ID for web app |
| `createBotService` | bool | `true` | Create Azure Bot Service registration |
| `cosmosServerless` | bool | `true` | Use serverless Cosmos DB |
| `enableSessionStorage` | bool | `true` | Enable NFS for CLI session persistence |
| `model` | string | `gpt-5.2` | Copilot LLM model |
| `agentName` | string | `copilot-api` | Agent identifier |
| `cliMinReplicas` | int | `1` | CLI server min replicas |
| `cliMaxReplicas` | int | `3` | CLI server max replicas |
| `agentMinReplicas` | int | `1` | Agent min replicas |
| `agentMaxReplicas` | int | `3` | Agent max replicas |
| `cosmosReaderObjectId` | string | - | Principal for Cosmos DB reader access |

## Modules

### Networking

| Module | File | Resources | Description |
|--------|------|-----------|-------------|
| VNet | `modules/vnet.bicep` | Virtual Network | `/16` CIDR with `/23` subnet, storage service endpoint |
| Private DNS | `modules/private-dns-zone.bicep` | Private DNS Zone | DNS resolution for NFS private endpoint |
| DNS A Record | `modules/dns-a-record.bicep` | DNS A Record | Maps private endpoint to DNS name |
| VNet (test) | `modules/vnet-test.bicep` | Virtual Network | Simplified VNet for testing |

### Compute

| Module | File | Resources | Description |
|--------|------|-----------|-------------|
| Container Env | `modules/container-app-env.bicep` | Container Apps Environment | VNet-integrated environment with NFS storage |
| CLI Server | `modules/container-app.bicep` | Container App | TCP:3000 internal, NFS volume mount, health check |
| API Service | `modules/api-service.bicep` | Container App | HTTP:4000 internal, Cosmos connection |
| Teams Agent | `modules/teams-copilot-agent.bicep` | Container App | HTTP:3978 external, Bot Framework |
| Web App | `modules/web-app.bicep` | Container App | HTTP:3001 external, Entra ID config |

### Data & Identity

| Module | File | Resources | Description |
|--------|------|-----------|-------------|
| Cosmos DB | `modules/cosmos-db.bicep` | Cosmos DB Account + Database | Serverless NoSQL, AAD-only (`disableLocalAuth: true`) |
| NFS Storage | `modules/nfs-storage.bicep` | Storage Account + File Share | Premium FileStorage with NFS + private endpoint |
| Bot Service | `modules/bot-service.bicep` | Bot Registration | Azure Bot Service with managed identity |

### Monitoring

| Module | File | Resources | Description |
|--------|------|-----------|-------------|
| App Insights | `modules/app-insights.bicep` | Application Insights + Log Analytics | Monitoring and telemetry |

### Other

| Module | File | Description |
|--------|------|-------------|
| Teams Bot | `modules/teams-bot.bicep` | Legacy Teams bot module |
| Test Client | `modules/test-client.bicep` | Container for running integration tests |

## Resource Naming

All resources use `baseName` as a prefix:

```
{baseName}-vnet          # Virtual Network
{baseName}-env           # Container App Environment
{baseName}-cli           # CLI Server container app
{baseName}-api           # API Service container app
{baseName}-agent         # Teams Agent container app
{baseName}-web           # Web App container app
{baseName}-cosmos        # Cosmos DB account
{baseName}-nfs           # NFS storage account
{baseName}-bot           # Bot Service registration
{baseName}-insights      # Application Insights
```

## Key Design Decisions

### Why NFS for CLI Session Storage?

The Copilot CLI (`copilot --server`) persists session state to `~/.copilot/session-state` on the filesystem. The SDK does not expose a pluggable storage interface. Without shared storage, `resumeSession()` fails when a different container handles the next request. NFS provides a shared filesystem mount across all CLI replicas.

### Why AAD-Only Cosmos DB?

Policy compliance — `disableLocalAuth: true` ensures no SAS keys. All access is via Managed Identity with RBAC role assignments (Cosmos DB Built-in Data Contributor).

### Why VNet Integration?

The CLI server and API service should not be exposed to the internet. VNet integration ensures all inter-service traffic stays private, with only the Teams Agent and Web App externally accessible.

## Outputs

The main template exports useful values for scripts and downstream configuration:

- Container app FQDNs (agent, web app)
- Bot Service app ID
- Cosmos DB endpoint
- Managed identity details
