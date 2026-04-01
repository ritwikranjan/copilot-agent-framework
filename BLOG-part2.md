# Building Stateless AI Agents That Scale, Part 2: Audit Logging, Streaming, MCP Tools, and a Complete API

*Audit logging, real-time streaming, MCP tool integration, custom database stores, and a production-ready Express API --- building on the stateless session pattern from Part 1*

---

In **Part 1**, we covered the **design pattern** for stateless AI agents: why horizontal scaling breaks with in-memory sessions, how `resumeSession()` enables cross-container conversation continuity, the two-tier persistence problem (application state + CLI session files), and how session management works end-to-end.

This article picks up where Part 1 left off. We'll go hands-on with the remaining capabilities of the `@ritwikranjan/copilot-agent-framework` library: audit logging for compliance, real-time streaming for responsive UX, MCP tool integration for agent actions, building custom database stores, pluggable logging, and finally --- tying it all together in a complete Express API.

If you haven't read Part 1, start there for the architectural context. This article assumes you're familiar with `CopilotService`, `SessionManager`, and `ISessionStore`.

---

## Audit Logging

If you're deploying an AI agent in production, you need to know what it said and what it did. This isn't optional for most production use cases --- it's a requirement for debugging, compliance, and analytics.

### The Audit Data Model

The audit system tracks two things:

**Interactions** --- One user message and one agent response:

```typescript
interface Interaction {
  id: string;
  session_id: string;        // Links to parent session
  user_query: string;        // What the user asked
  copilot_response?: string; // What the agent answered
  tool_execution_ids: string[]; // Which tools were called
  timestamp: string;
  reasoning?: string;        // Model's thinking process (if captured)
}
```

**Tool Executions** --- One MCP tool call with its arguments and result:

```typescript
interface ToolExecution {
  id: string;
  session_id: string;
  interaction_id?: string;   // Links to parent interaction
  tool_name: string;         // e.g., "azure_list_deployments"
  arguments?: Record<string, unknown>;
  result?: unknown;
  status: ToolExecutionStatus; // STARTED | COMPLETED | ERROR
  start_time: string;
  end_time?: string;
  error_message?: string;
}
```

This gives you a full audit trail: user asked X, agent called tools Y and Z, agent responded with W. Every tool call has timing data so you can see how long each external API call took.

### Using the Audit Manager

```typescript
import {
  AuditManager,
  InMemoryAuditStore,
} from '@ritwikranjan/copilot-agent-framework';

const auditStore = new InMemoryAuditStore();
const auditManager = new AuditManager({ store: auditStore });

const copilot = new CopilotService(
  {
    cliUrl: 'localhost:3000',
    model: 'gpt-5.2',
    agentName: 'my-agent',
    enableAudit: true,      // This is the default; shown here for clarity
  },
  sessionManager,
  auditManager,             // Pass as optional third argument
);
```

When you pass an `AuditManager` to `CopilotService`, it automatically logs every interaction and tool execution. You don't need to call the audit methods manually --- the service handles it during message processing.

### Audit Is Optional

Not every use case needs audit logging. The `AuditManager` is an optional constructor argument. If you omit it, everything still works --- no audit records are created, and there's no performance overhead.

```typescript
// No audit — just pass sessionManager
const copilot = new CopilotService(config, sessionManager);

// With audit
const copilot = new CopilotService(config, sessionManager, auditManager);
```

---

## Streaming

Nobody wants to stare at a blank screen for 10 seconds while the AI thinks. Streaming sends content to the client as it's generated, token by token. This is the same pattern you see in ChatGPT's UI --- text appearing gradually.

### The IStreamHandler Interface

The framework uses a minimal, framework-agnostic interface:

```typescript
interface IStreamHandler {
  emit(content: string): void;     // Send content chunk to client
  update?(status: string): void;   // Optional status update
}
```

This is intentionally simple. Whether you're using Express with Server-Sent Events, WebSockets, a CLI that writes to stdout, or a Teams bot --- you implement these two methods and the framework handles the rest.

### Express SSE Example

Here's how streaming works with a standard Express server using Server-Sent Events:

```typescript
app.post('/chat/stream', async (req, res) => {
  const { message, conversationId } = req.body;
  const userInfo = { username: 'api-user', hostname: 'http' };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const streamHandler = {
    emit: (content: string) =>
      res.write(`data: ${JSON.stringify({ content })}\n\n`),
    update: (status: string) =>
      res.write(`data: ${JSON.stringify({ status })}\n\n`),
  };

  const response = await copilot.sendMessageStreaming(
    message, userInfo, streamHandler, { conversationId }
  );

  res.write(`data: ${JSON.stringify({ done: true, ...response })}\n\n`);
  res.end();
});
```

### What Events Are Streamed?

Under the hood, the Copilot SDK emits a series of events during a streaming response. The framework handles each one:

```
+----------------------------+---------------------------------------------------------------------------+
| Event                      | What happens                                                              |
+----------------------------+---------------------------------------------------------------------------+
| assistant.turn_start       | New turn begins; resets content tracking                                  |
| assistant.message_delta    | Content chunk emitted to client via streamHandler.emit()                  |
| assistant.message          | Final complete message for the turn (content already streamed via deltas) |
| assistant.reasoning_delta  | Model's thinking process (optionally shown via update())                  |
| assistant.reasoning        | Final complete reasoning for the turn                                     |
| assistant.turn_end         | Turn ends; newline separator emitted                                      |
| tool.execution_start       | Tool usage notification emitted to client                                 |
| tool.execution_progress    | Tool progress message shown to user                                       |
| tool.execution_complete    | Tool result logged to audit                                               |
| session.idle               | Streaming complete, promise resolves                                      |
| session.error              | Error emitted, promise rejects                                            |
+----------------------------+---------------------------------------------------------------------------+
```

The framework accumulates the full response text for audit records while simultaneously streaming individual chunks to the client.

---

## Building Your Own Store

The `InMemorySessionStore` and `InMemoryAuditStore` are for development only --- data is lost when the process restarts. For production, you implement the store interfaces against your database.

### ISessionStore Interface

```typescript
interface ISessionStore {
  initialize(): Promise<void>;
  createSession(sessionData: SessionInfo): Promise<SessionInfo>;
  updateSession(sessionId: string, partitionKey: string, sessionData: SessionInfo): Promise<SessionInfo>;
  getSession(sessionId: string, partitionKey: string): Promise<SessionInfo | null>;
  getSessionByName(username: string, sessionName: string): Promise<SessionInfo | null>;
  getSessionsByUser(username: string): Promise<SessionInfo[]>;
  getSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null>;
}
```

### Example: Cosmos DB Implementation

Here's a skeleton implementation for Azure Cosmos DB:

```typescript
import type { ISessionStore, SessionInfo } from '@ritwikranjan/copilot-agent-framework';
import { CosmosClient, Container } from '@azure/cosmos';

export class CosmosSessionStore implements ISessionStore {
  private container!: Container;

  async initialize(): Promise<void> {
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT!,
      aadCredentials: new DefaultAzureCredential(),
    });
    this.container = client.database('mydb').container('sessions');
  }

  async createSession(sessionData: SessionInfo): Promise<SessionInfo> {
    const { resource } = await this.container.items.create({
      ...sessionData,
      partitionKey: sessionData.user_info.username,
    });
    return resource as SessionInfo;
  }

  async getSession(sessionId: string, partitionKey: string): Promise<SessionInfo | null> {
    try {
      const { resource } = await this.container.item(sessionId, partitionKey).read();
      return resource as SessionInfo;
    } catch {
      return null;
    }
  }

  async getSessionByConversationId(
    username: string,
    conversationId: string
  ): Promise<SessionInfo | null> {
    const { resources } = await this.container.items
      .query({
        query: `SELECT * FROM c WHERE c.user_info.username = @username
                AND c.conversation_id = @convId AND c.status = 'active'`,
        parameters: [
          { name: '@username', value: username },
          { name: '@convId', value: conversationId },
        ],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  // ... implement remaining methods similarly
}
```

### Partition Key Design

The `partitionKey` parameter in `updateSession` and `getSession` exists for Cosmos DB compatibility. The framework uses these partition keys:

```
+------------------+---------------------+-------------------------------------------+
| Data             | Partition Key       | Why                                       |
+------------------+---------------------+-------------------------------------------+
| Sessions         | username            | All sessions for a user = 1 partition     |
| Interactions     | session_id          | All interactions for a session = 1 query  |
| Tool Executions  | session_id          | Same reasoning as interactions            |
+------------------+---------------------+-------------------------------------------+
```

If your database doesn't use partition keys (e.g., PostgreSQL, Redis), you can ignore this parameter in your implementation.

---

## MCP: Connecting Tools to Your Agent

**Model Context Protocol (MCP)** is the standard for letting AI models call external tools. If you want your agent to do more than just generate text --- query databases, call APIs, run commands --- you need MCP.

The framework supports MCP tool configuration via a JSON file:

```json
{
  "mcp_servers": {
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"],
      "env": {
        "AZURE_SUBSCRIPTION_ID": "your-subscription-id"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@github/mcp-server"],
      "env": {
        "GITHUB_TOKEN": "your-token"
      }
    }
  }
}
```

Each MCP server is a child process that the Copilot SDK manages. When the model decides to use a tool, the SDK routes the call to the appropriate MCP server.

Load and use tools in your service:

```typescript
import { loadToolsConfig, buildMcpServersConfig } from '@ritwikranjan/copilot-agent-framework';

const toolsConfig = loadToolsConfig();
const mcpServers = buildMcpServersConfig(toolsConfig);

const copilot = new CopilotService(
  {
    cliUrl: 'localhost:3000',
    model: 'gpt-5.2',
    agentName: 'my-agent',
    mcpServers, // Tools are now available to the model
  },
  sessionManager,
);
```

When a tool executes during streaming, the framework emits a notification to the client (so users see tool activity) and logs it to the audit trail (so you can review what happened).

---

## Pluggable Logging

The framework is **silent by default**. No `console.log` pollution in your application. Under the hood, it uses the [`debug`](https://www.npmjs.com/package/debug) package with namespaced loggers.

### Enable via Environment Variable

```bash
DEBUG=copilot:*              # All framework logs
DEBUG=copilot:session        # Session manager only
DEBUG=copilot:audit          # Audit manager only
DEBUG=copilot:service        # CopilotService only
DEBUG=copilot:config         # System prompt and tools config loading
```

### Inject Your Own Logger

If your application uses a structured logger like Winston or Pino, you can route all framework logs through it:

```typescript
import { setLogger } from '@ritwikranjan/copilot-agent-framework';

setLogger({
  debug: (msg, ...args) => myLogger.debug(msg, ...args),
  info:  (msg, ...args) => myLogger.info(msg, ...args),
  warn:  (msg, ...args) => myLogger.warn(msg, ...args),
  error: (msg, ...args) => myLogger.error(msg, ...args),
});
```

You can also pass a logger per-component if you need different logging configurations for sessions vs. audit vs. the main service:

```typescript
const sessionManager = new SessionManager({ store: myStore, logger: sessionLogger });
const auditManager = new AuditManager({ store: auditStore, logger: auditLogger });
```

---

## Putting It All Together: A Complete HTTP API

Here's a complete Express application that ties everything together --- session management, audit logging, synchronous and streaming endpoints:

```typescript
import express from 'express';
import {
  CopilotService,
  SessionManager,
  AuditManager,
  InMemorySessionStore,
  InMemoryAuditStore,
  loadSystemPrompt,
} from '@ritwikranjan/copilot-agent-framework';

const app = express();
app.use(express.json());

// Set up stores (replace with your database implementation for production)
const sessionStore = new InMemorySessionStore();
const auditStore = new InMemoryAuditStore();
const sessionManager = new SessionManager({ store: sessionStore });
const auditManager = new AuditManager({ store: auditStore });

// Create the Copilot service
const copilot = new CopilotService(
  {
    cliUrl: process.env.CLI_URL || 'localhost:3000',
    model: 'gpt-5.2',
    agentName: 'http-agent',
    systemPrompt: loadSystemPrompt(),
  },
  sessionManager,
  auditManager,
);

// POST /chat — synchronous response
app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  const userInfo = { username: 'api-user', hostname: 'http' };
  const response = await copilot.sendMessage(message, userInfo, { conversationId });
  res.json(response);
});

// POST /chat/stream — streaming via Server-Sent Events
app.post('/chat/stream', async (req, res) => {
  const { message, conversationId } = req.body;
  const userInfo = { username: 'api-user', hostname: 'http' };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const streamHandler = {
    emit: (content: string) => res.write(`data: ${JSON.stringify({ content })}\n\n`),
    update: (status: string) => res.write(`data: ${JSON.stringify({ status })}\n\n`),
  };

  const response = await copilot.sendMessageStreaming(
    message, userInfo, streamHandler, { conversationId }
  );
  res.write(`data: ${JSON.stringify({ done: true, ...response })}\n\n`);
  res.end();
});

app.listen(8080, () => console.log('Agent listening on port 8080'));
```

Deploy this behind a load balancer with multiple instances, and every instance can handle any conversation --- because all state lives in the store.

---

## Conclusion

Across these two articles, we've covered the full stack of building a production AI agent:

- **Part 1**: The stateless session pattern --- externalize state, resume sessions across containers, bridge the CLI filesystem gap with NFS
- **Part 2**: The implementation layer --- audit logging for compliance, streaming for UX, MCP for tool integration, pluggable stores and logging

The core **design pattern** is straightforward --- externalize all session state to a database, use the SDK's `resumeSession()` to reconnect from any container, and handle the CLI server's filesystem dependency with shared storage. This pattern isn't Azure-specific; it's the same idea behind stateless web services, applied to AI conversations.

The reference implementation on **Azure Container Apps** demonstrates this pattern end-to-end:

- **Copilot CLI in headless mode** running in a dedicated container (TCP port 3000, internal only)
- **Stateless session management** with cross-container resume via stored Copilot SDK session IDs
- **Two-tier persistence** --- application state in Cosmos DB; CLI session files on NFS-mounted Azure Files
- **Audit logging** tracking every user query, agent response, and tool execution
- **Framework-agnostic streaming** via a simple `IStreamHandler` interface
- **Pluggable persistence** --- implement `ISessionStore` and `IAuditStore` for any database

The Azure infrastructure (ACA, Cosmos DB, NFS, managed identity, VNet) is one way to deploy this. The pattern itself --- externalized state, resume-capable sessions, shared CLI storage --- works on any platform that supports containers and a shared filesystem or database.

### Get Started

```bash
npm install @ritwikranjan/copilot-agent-framework @github/copilot-sdk
```

- **npm**: `@ritwikranjan/copilot-agent-framework`
- **GitHub**: `github.com/ritwikranjan/copilot-agent-framework`

### What's Next

Some directions I'm considering for future development:

- **Redis session store** --- For teams already running Redis for caching
- **PostgreSQL/MongoDB store adapters** --- Prebuilt implementations for common databases
- **OpenTelemetry integration** --- Distributed tracing across agent, tools, and LLM calls
- **WebSocket streaming adapter** --- Beyond SSE for bidirectional communication
- **Rate limiting and quota management** --- Per-user usage controls
- **Non-Azure reference deployments** --- ECS/Fargate, GKE, or plain Docker Swarm

The framework is MIT licensed. If you build something interesting with it, I'd be glad to hear about it. Contributions are welcome.

---

*If you found this useful, follow me for more content on building AI-powered tools and system design for production AI applications.*
