#!/bin/sh
# Entrypoint for Copilot CLI in Container Apps
# Caches managed identity env vars before starting the CLI server

# Cache identity env vars (Container Apps provides these)
# Must capture before Copilot CLI spawns subprocesses with different env
cat > /tmp/.azure_identity << EOF
export IDENTITY_ENDPOINT="$IDENTITY_ENDPOINT"
export IDENTITY_HEADER="$IDENTITY_HEADER"
export AZURE_TENANT_ID="$AZURE_TENANT_ID"
EOF

# Start Copilot CLI
cd /usr/local/lib/node_modules/@github/copilot || exit 1
exec node index.js "$@"
