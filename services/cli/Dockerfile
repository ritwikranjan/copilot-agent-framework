FROM node:24-slim

# Install dependencies:
# - libicu72: Required for Azure MCP (.NET runtime)
# - netcat-openbsd: Health check probe
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl ca-certificates libicu72 netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Install Copilot CLI and Azure MCP (latest)
RUN npm install -g @github/copilot @azure/mcp

# Copy wrapper scripts
COPY scripts/azmcp-wrapper.sh /usr/local/bin/azmcp-wrapper
COPY scripts/copilot-entrypoint.sh /usr/local/bin/copilot-entrypoint

# Fix CRLF line endings (Windows → Unix)
RUN sed -i 's/\r$//' /usr/local/bin/azmcp-wrapper /usr/local/bin/copilot-entrypoint

# Replace azmcp with wrapper (injects managed identity env vars from cache)
RUN mv $(which azmcp) /usr/local/bin/azmcp-real \
    && mv /usr/local/bin/azmcp-wrapper /usr/local/bin/azmcp \
    && chmod +x /usr/local/bin/azmcp /usr/local/bin/copilot-entrypoint

EXPOSE 3000

CMD ["/usr/local/bin/copilot-entrypoint", "--server", "--port", "3000", "--allow-all", "--log-level", "debug"]
