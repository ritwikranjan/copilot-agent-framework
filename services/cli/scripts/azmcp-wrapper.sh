#!/bin/sh
# Wrapper for azmcp that injects managed identity env vars from cached file
# Required because Copilot CLI doesn't inherit parent env vars when spawning MCP servers

# Source cached identity (set at container startup before CLI can override)
[ -f /tmp/.azure_identity ] && . /tmp/.azure_identity

# Force production credential chain
export AZURE_TOKEN_CREDENTIALS="${AZURE_TOKEN_CREDENTIALS:-prod}"
# AZURE_TENANT_ID must be set via container environment variables
export AZURE_TENANT_ID="${AZURE_TENANT_ID:?AZURE_TENANT_ID environment variable is required}"

exec /usr/local/bin/azmcp-real "$@"
