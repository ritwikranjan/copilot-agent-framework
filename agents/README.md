# Copilot Agents

This directory contains example system prompts for customizing the Teams Copilot Agent. The unified architecture deploys a single Teams-integrated agent that you can customize via system prompts.

## Architecture

The new unified architecture deploys:
    - **CLI Server**: Runs `copilot --server` internally
    - **Teams Copilot Agent**: Connects to Teams via Bot Framework and uses the CLI server

```text
Microsoft Teams
      │
      ▼
Teams Copilot Agent ──▶ CLI Server ──▶ GitHub Copilot API
      │
      ▼
  System Prompt
```

## Quick Start

### 1. Choose or Create an Agent Profile

Each agent is a directory under `agents/` with at minimum a `system-prompt.md` file:

```text
agents/
├── code-reviewer/
│   └── system-prompt.md
├── writing-assistant/
│   └── system-prompt.md
└── my-custom-agent/
    ├── system-prompt.md      # Required
    └── tools-config.json     # Optional (MCP tools)
```

### 2. Deploy with an Agent Profile

**Via the deploy script:**

```powershell
.\scripts\deploy-unified.ps1 `
  -ResourceGroup "copilot-unified-rg" `
  -AcrName "myacr" `
  -AcrResourceGroup "acr-rg" `
  -GithubToken "ghp_your_token" `
  -AgentProfile "code-reviewer"
```

**Or build the Docker image directly:**

```bash
# From the repo root (build context must be the root)
docker build \
  -t my-registry/teams-copilot-agent:code-reviewer \
  -f services/teams-copilot-agent/Dockerfile \
  --build-arg AGENT_PROFILE=code-reviewer \
  .

docker push my-registry/teams-copilot-agent:code-reviewer
```

The Dockerfile's `agent-config` stage selects the profile's `system-prompt.md` and `tools-config.json` at build time. If the profile doesn't include a file, the service default is used.

### 3. Local Development with Agent Profiles

Set `AGENT_PROFILE` in your `.env` file or pass it directly:

```bash
# Using .env
echo "AGENT_PROFILE=code-reviewer" >> .env
docker-compose -f docker-compose.unified.yml up --build

# Or inline
AGENT_PROFILE=code-reviewer docker-compose -f docker-compose.unified.yml up --build
```

Open DevTools at <http://localhost:3979/devtools>

### 4. Use in Teams

After deployment:
    1. Create a Teams app manifest with the Bot ID from deployment outputs
    2. Upload to Teams Admin Center
    3. Chat with the bot in Teams!

## Example System Prompts

### Code Reviewer

See `agents/code-reviewer/system-prompt.md`:

```markdown
# Code Reviewer Agent

You are an expert code reviewer. Analyze code for:
- Bugs and potential issues
- Performance optimizations
- Security vulnerabilities
- Best practices and patterns

Provide constructive feedback with specific suggestions.
```

### Writing Assistant

See `agents/writing-assistant/system-prompt.md`:

```markdown
# Writing Assistant

You help improve written content by:
- Fixing grammar and spelling
- Improving clarity and flow
- Suggesting better word choices
- Maintaining consistent tone
```

## Customization Options

### System Prompt

The system prompt defines the agent's behavior, personality, and capabilities. Place it in your agent profile directory:
    - `agents/<your-agent>/system-prompt.md`

The service defaults in `services/teams-copilot-agent/system-prompt.md` are used when no agent profile is specified.

You can also override at runtime via environment variables:
    - `SYSTEM_PROMPT` — inline prompt content
    - `SYSTEM_PROMPT_PATH` — path to a prompt file

### MCP Tools

Add custom tools via `tools-config.json` in your agent profile directory:

```json
{
  "description": "MCP tools for my agent",
  "mcp_servers": {
    "azure": {
      "tools": ["cosmos"],
      "command": "azmcp",
      "args": ["server", "start"]
    }
  }
}
```

If your agent doesn't need MCP tools, you can omit this file and the service default will be used.

### Model Selection

Change the model in deployment:

```powershell
.\scripts\deploy-unified.ps1 ... -Model "gpt-4.1"
```

Available models depend on your GitHub Copilot subscription.

## Local Development

Test your custom agent locally using the `AGENT_PROFILE` variable:

```bash
# Set the agent profile and start
AGENT_PROFILE=my-agent docker-compose -f docker-compose.unified.yml up -d --build

# Test with DevTools
open http://localhost:3979/devtools
```

Or without a profile (uses the service defaults):

```bash
docker-compose -f docker-compose.unified.yml up -d --build
```

## Creating a New Agent Persona

1. **Create a directory** under `agents/`:

    ```bash
    mkdir agents/my-agent
    ```

2. **Add a `system-prompt.md`** with your agent's instructions (see existing agents for examples)

3. **Optionally add `tools-config.json`** if your agent needs MCP tools

4. **Test locally**:

    ```bash
    AGENT_PROFILE=my-agent docker-compose -f docker-compose.unified.yml up --build
    ```

5. **Deploy**:

    ```powershell
    .\scripts\deploy-unified.ps1 ... -AgentProfile "my-agent"
    ```

## Migration from Multi-Agent Architecture

If you previously used `deploy-agent.ps1` to deploy multiple agents:

1. **Consolidate prompts**: Combine specialized prompts into a single versatile prompt, OR
2. **Deploy multiple instances**: Run `deploy-unified.ps1` with different base names

The unified architecture is simpler but if you need multiple distinct agents, you can still deploy separate instances with different system prompts.

## Security

- **Teams Authentication**: Users must be authenticated via Teams/Azure AD
- **Audit Logging**: All interactions are logged to Cosmos DB (optional)
- **Managed Identity**: No secrets stored in the agent
- **VNet Isolation**: CLI server is not exposed publicly

## See Also

- [Main README](../README.md) - Project overview
- [Teams Copilot Agent](../services/teams-copilot-agent/README.md) - Service details
- [Deployment Guide](../scripts/deploy-unified.ps1) - Deployment options
