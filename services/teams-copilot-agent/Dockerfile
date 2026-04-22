# Teams Copilot Agent Dockerfile
# Thin frontend that delegates to the internal API service.
#
# Supports agent profiles via AGENT_PROFILE build arg:
#   docker build --build-arg AGENT_PROFILE=dnc-cosmos-expert ...
#
# Build context must be the repository root.

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace config (needed for npm workspace resolution)
COPY package.json package-lock.json ./

# Copy only the teams-copilot-agent service
COPY services/teams-copilot-agent/package.json ./services/teams-copilot-agent/
COPY services/teams-copilot-agent/tsconfig.json services/teams-copilot-agent/tsup.config.js ./services/teams-copilot-agent/

# Install dependencies + rollup musl variant for Alpine
RUN npm ci --workspace=services/teams-copilot-agent --include-workspace-root && \
    npm install @rollup/rollup-linux-x64-musl --save-optional 2>/dev/null || true

# Copy source and build
COPY services/teams-copilot-agent/src/ ./services/teams-copilot-agent/src/
RUN npm run build --workspace=services/teams-copilot-agent

# Agent profile selector stage — resolves which config files to use
FROM node:24-alpine AS agent-config

ARG AGENT_PROFILE=""

WORKDIR /config

# Copy service defaults
COPY services/teams-copilot-agent/system-prompt.md ./default-system-prompt.md
COPY services/teams-copilot-agent/tools-config.json ./default-tools-config.json

# Copy entire agents directory (for profile selection)
COPY agents/ ./agents/

# Select the right config: agent profile overrides service defaults
RUN if [ -n "$AGENT_PROFILE" ] && [ -f "./agents/$AGENT_PROFILE/system-prompt.md" ]; then \
        cp "./agents/$AGENT_PROFILE/system-prompt.md" ./system-prompt.md; \
        echo "Using system prompt from agent profile: $AGENT_PROFILE"; \
    else \
        cp ./default-system-prompt.md ./system-prompt.md; \
        echo "Using default system prompt"; \
    fi && \
    if [ -n "$AGENT_PROFILE" ] && [ -f "./agents/$AGENT_PROFILE/tools-config.json" ]; then \
        cp "./agents/$AGENT_PROFILE/tools-config.json" ./tools-config.json; \
        echo "Using tools config from agent profile: $AGENT_PROFILE"; \
    else \
        cp ./default-tools-config.json ./tools-config.json; \
        echo "Using default tools config"; \
    fi

# Production stage — use Node 22 for ESM compatibility with @github/copilot-sdk
FROM node:22-alpine

WORKDIR /app

# Copy service package.json, strip the workspace dep (already bundled by tsup)
COPY services/teams-copilot-agent/package.json ./package.json
# Install production dependencies only
RUN npm install --omit=dev

# Copy built service from builder (tsup bundles the library into the service dist)
COPY --from=builder /app/services/teams-copilot-agent/dist ./dist

# Copy resolved configuration files from agent-config stage
COPY --from=agent-config /config/system-prompt.md ./system-prompt.md
COPY --from=agent-config /config/tools-config.json ./tools-config.json

# Create directory for mounted config files (runtime overrides)
RUN mkdir -p /app/config

# Set default ports
ENV PORT=3978
ENV NODE_ENV=production

# Expose the port
EXPOSE 3978

# Health check - the Teams SDK serves 200 at root
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3978/ || exit 1

# Start the service
CMD ["node", "dist/index.js"]