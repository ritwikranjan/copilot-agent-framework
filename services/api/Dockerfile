# API Service Dockerfile — internal HTTP service
# Multi-stage build: builder → production
FROM node:24-alpine AS builder
WORKDIR /workspace

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy workspace packages
COPY packages/stateless-copilot-sdk/package.json packages/stateless-copilot-sdk/
COPY services/api/package.json services/api/

# Install all workspace deps + rollup musl variant for Alpine
RUN npm ci --workspace=packages/stateless-copilot-sdk --workspace=services/api --include-workspace-root && \
    npm install @rollup/rollup-linux-x64-musl --save-optional 2>/dev/null || true

# Copy source
COPY packages/stateless-copilot-sdk/ packages/stateless-copilot-sdk/
COPY services/api/ services/api/

# Build SDK first, then API service
RUN cd packages/stateless-copilot-sdk && npx tsup --no-dts
RUN cd services/api && npx tsup

# Production stage
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy built output
COPY --from=builder /workspace/services/api/dist/ ./dist/
COPY --from=builder /workspace/services/api/package.json ./

# Copy node_modules (production only)
COPY --from=builder /workspace/node_modules/ ./node_modules/
COPY --from=builder /workspace/packages/stateless-copilot-sdk/dist/ ./node_modules/@ritwikranjan/copilot-agent-framework/dist/
COPY --from=builder /workspace/packages/stateless-copilot-sdk/package.json ./node_modules/@ritwikranjan/copilot-agent-framework/

# Fix @github/copilot-sdk ESM import issue (handle both single and double quotes)
RUN find ./node_modules/@github/copilot-sdk -name "*.js" -exec \
    sed -i 's|vscode-jsonrpc/node"|vscode-jsonrpc/node.js"|g; s|vscode-jsonrpc/node'"'"'|vscode-jsonrpc/node.js'"'"'|g' {} + 2>/dev/null || true

# Mount point for system prompt and tools config
VOLUME ["/app/config"]

# Copy default agent config (can be overridden by volume mount or env vars)
ARG AGENT_PROFILE=""
COPY agents/${AGENT_PROFILE:-_default}/system-prompt.md ./system-prompt.md
COPY agents/${AGENT_PROFILE:-_default}/tools-config.json ./tools-config.json

EXPOSE 4000
CMD ["node", "--experimental-specifier-resolution=node", "dist/index.js"]
