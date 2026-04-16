# Scripts

PowerShell and Node.js scripts for building, deploying, and testing the Copilot Agent Framework.

## Scripts Overview

| Script | Description |
|--------|-------------|
| `deploy-unified.ps1` | Full deployment orchestrator — builds, pushes, deploys infrastructure |
| `build-and-push.ps1` | Builds and pushes a Docker image to Azure Container Registry |
| `run-tests.ps1` | Triggers test execution in the Azure test client container |
| `test-connection.mjs` | Quick connectivity check for the CLI server |

## deploy-unified.ps1

Main deployment script. Builds Docker images for all 4 services, pushes to ACR, and deploys the Bicep infrastructure.

### Usage

```powershell
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -GithubToken "ghp_xxx"
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-ResourceGroup` | Yes | - | Azure resource group |
| `-AcrName` | Yes | - | Azure Container Registry name |
| `-GithubToken` | Yes | - | GitHub PAT with Copilot access |
| `-BaseName` | No | `copilot-unified` | Base name for all resources |
| `-Location` | No | `eastus` | Azure region |
| `-AcrResourceGroup` | No | (same as RG) | ACR resource group |
| `-Model` | No | `gpt-5.2` | Copilot model |
| `-CreateBotService` | No | `$true` | Create Azure Bot Service |
| `-CliImageTag` | No | `latest` | CLI server image tag |
| `-ApiImageTag` | No | `latest` | API service image tag |
| `-AgentImageTag` | No | `latest` | Teams agent image tag |
| `-WebImageTag` | No | `latest` | Web app image tag |
| `-AgentName` | No | `copilot-api` | Agent identifier |
| `-EntraClientId` | No | - | Entra ID client ID for web app auth |
| `-AgentProfile` | No | - | Agent profile directory (e.g., `code-reviewer`) |
| `-SkipBuild` | No | - | Skip Docker build (use existing images) |
| `-SkipInfra` | No | - | Skip Bicep deployment |
| `-SkipManifest` | No | - | Skip Teams manifest generation |

### Examples

```powershell
# Full deployment
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -GithubToken "ghp_xxx"

# Deploy with a custom agent profile
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -GithubToken "ghp_xxx" `
    -AgentProfile "code-reviewer"

# Deploy infrastructure only (skip Docker build)
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -GithubToken "ghp_xxx" `
    -SkipBuild

# Update images only (skip Bicep deployment)
.\scripts\deploy-unified.ps1 `
    -ResourceGroup "copilot-unified-rg" `
    -AcrName "myacr" `
    -GithubToken "ghp_xxx" `
    -SkipInfra
```

## build-and-push.ps1

Builds a single Docker image and pushes it to ACR.

### Usage

```powershell
.\scripts\build-and-push.ps1 -AcrName "myacr"
.\scripts\build-and-push.ps1 -AcrName "myacr" -ImageName "copilot-cli-server" -ImageTag "v1.0.0"
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-AcrName` | Yes | - | Azure Container Registry name |
| `-ImageName` | No | `copilot-cli-server` | Docker image name |
| `-ImageTag` | No | `latest` | Image tag |

## run-tests.ps1

Triggers test execution in the Azure-deployed test client container by scaling it to 1 replica.

### Usage

```powershell
.\scripts\run-tests.ps1 -ResourceGroupName "copilot-unified-rg"
.\scripts\run-tests.ps1 -ResourceGroupName "copilot-unified-rg" -Follow
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-ResourceGroupName` | Yes | - | Resource group with test infrastructure |
| `-TestAppName` | No | `copilot-cli-test-client` | Test client container app name |
| `-Follow` | No | - | Stream test logs after triggering |

## test-connection.mjs

Node.js script that verifies TCP connectivity to the CLI server.

### Usage

```bash
node scripts/test-connection.mjs              # Default: localhost:3000
node scripts/test-connection.mjs host:port     # Custom address
```

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) (for deployment scripts)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (for building images)
- [Node.js 22+](https://nodejs.org/) (for test-connection.mjs)
- PowerShell 7+ (for .ps1 scripts)
