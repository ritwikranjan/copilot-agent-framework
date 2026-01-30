# Copilot CLI Server

TCP server running GitHub Copilot CLI (`@github/copilot`) with Azure MCP integration.

For high-level architecture and deployment instructions, see the [Project Root README](../../README.md).

## Overview

This container runs the Copilot CLI in server mode, accepting TCP connections from the Teams Copilot Agent. It includes Azure MCP for accessing Azure resources via managed identity.

## Scalability & Persistence

This service is designed to be horizontally scalable when deployed with Azure Files (NFS):

- **Stateless Compute**: Container instances can be created/destroyed freely.
- **Shared State**: The Copilot CLI's config directory is mounted via NFS to a shared Azure File Share.
- **Session Consistency**: All replicas share the same authentication and configuration state.

## Managed Identity Integration

Container Apps provides managed identity via environment variables:

- `IDENTITY_ENDPOINT` - Token endpoint URL
- `IDENTITY_HEADER` - Authentication header

Since Copilot CLI spawns MCP servers as subprocesses with different env vars, we use wrapper scripts to:

1. Cache identity env vars at container startup (`copilot-entrypoint.sh`)
2. Inject cached values when spawning azmcp (`azmcp-wrapper.sh`)

## Build & Deploy

```powershell
# Build and push
az acr login --name acndev
docker build -t acndev.azurecr.io/copilot-cli:v8 -f services/cli/Dockerfile services/cli --push

# Deploy
az containerapp update -n copilot-unified-cli -g copilot-unified-rg --image acndev.azurecr.io/copilot-cli:v8
```

## Files

- `Dockerfile` - Container image definition
- `scripts/azmcp-wrapper.sh` - Injects managed identity env vars into azmcp
- `scripts/copilot-entrypoint.sh` - Caches identity at startup, runs CLI
