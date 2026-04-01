# Building Stateless AI Agents That Scale: A Design Pattern for GitHub Copilot on Azure

*A design pattern for horizontal scaling, session management, and audit logging on top of the Copilot SDK --- deployed on Azure Container Apps*

---

You want to deploy an AI agent in production. It needs to handle thousands of concurrent conversations, scale horizontally across multiple server instances, and keep track of what happened in every conversation for debugging and compliance.

Sounds straightforward, right? Just spin up some containers, wire up the LLM, and go.

Except there's a problem. Most AI agent frameworks keep conversation state in memory. The moment you add a second container behind a load balancer, things break. User A starts a conversation on Container 1, and their next message hits Container 2, which knows nothing about that conversation.

This article walks through a **design pattern** for solving this problem --- stateless session management for AI agents --- and a proof-of-concept implementation built on the **GitHub Copilot SDK**, deployed to **Azure Container Apps (ACA)**. The reference architecture uses Azure services (Cosmos DB, Azure Files NFS, Azure Bot Service, managed identity), but the core pattern --- externalized session state with resume-capable SDK sessions --- applies to any cloud or container platform. What we describe here is tied to Azure; extending it to AWS or GCP is an infrastructure exercise, not an architectural one.

If you've ever built a web API that scales horizontally --- think Express apps behind a load balancer --- the same principles apply here, just with AI conversations instead of HTTP sessions.

By the end, you'll understand:

- What the GitHub Copilot SDK is and how it works
- Why stateless architecture matters for AI agents
- The design pattern that enables horizontal scaling for AI conversations
- How session management, audit logging, and streaming fit together in practice

The proof-of-concept framework is published as `@ritwikranjan/copilot-agent-framework` on npm, and the full source (including Azure infrastructure as code) is on GitHub.

---

## What Are AI Agents?

Before diving into architecture, let's make sure we're on the same page about what an "AI agent" actually is.

An **AI agent** is a program that uses a large language model (LLM) to accomplish tasks --- not just answer questions, but *take actions*. When you ask a chatbot "What's the weather?", it generates text. When you ask an agent "Deploy my app to staging", it actually calls APIs, runs commands, and reports the result.

The magic ingredient is **tool calling** (also known as function calling). The LLM doesn't just produce text --- it can decide to invoke external tools. The conversation goes like this:

1. **User**: "List my Azure deployments"
2. **LLM decides**: I need to call the `azure_list_deployments` tool
3. **Tool executes**: Calls the Azure API, returns the deployment list
4. **LLM responds**: "You have 3 active deployments: web-app, api-server, and worker"

The standard for connecting AI models to tools is called the **Model Context Protocol (MCP)**. MCP defines how tools are discovered, how the model requests tool calls, and how results flow back. Think of it like HTTP for AI tool integration --- it provides a standard protocol so models and tools can interoperate.

---

## What Is the GitHub Copilot SDK?

The [GitHub Copilot SDK](https://github.com/github/copilot-sdk) is an open-source library that gives you programmatic access to Copilot's AI capabilities. It's available in multiple languages (TypeScript, Python, Go, and more) --- this article uses the TypeScript variant (`@github/copilot-sdk`), but the concepts apply regardless of language. It handles:

- **Model interaction**: Sending prompts and receiving responses
- **Session management**: Multi-turn conversations where the model remembers previous messages
- **MCP tool execution**: Running external tools when the model decides it needs them

The SDK communicates with the **Copilot CLI running in headless server mode** (`copilot --server`). In our reference architecture, this CLI process runs in its own container, exposed internally on port 3000 via TCP ingress. It is not accessible from the public internet --- only other containers within the same Azure Container Apps environment can reach it. Your application container connects to it using `CopilotClient({ cliUrl: 'localhost:3000' })` (or the internal container hostname).

Here's the most basic usage:

```typescript
import { CopilotClient } from '@github/copilot-sdk';

// Connects to the Copilot CLI running in headless mode on a separate container
const client = new CopilotClient({ cliUrl: 'localhost:3000' });

const session = await client.createSession({
  model: 'gpt-5.2',
  systemMessage: { mode: 'replace', content: 'You are a helpful assistant.' }
});

const response = await session.sendAndWait({ prompt: 'Hello!' });
console.log(response.data.content);
```

This works fine for a single process. But there's a catch.

**The session object lives in memory.** The `client.createSession()` call creates an internal session that tracks conversation history. If that process restarts, the session is gone. If a load balancer routes the next request to a different container, that container has no way to access the session.

This is the fundamental gap that the stateless session pattern addresses.

---

## Why Stateless? The Architecture Decision

Let's visualize the problem with a concrete example.

### The Stateful Problem

Imagine you have two containers behind a load balancer:

```ascii
User msg 1 ──> Load Balancer ──> Container A
                                   └── Creates session in memory
                                   └── Responds to user

User msg 2 ──> Load Balancer ──> Container B
                                   └── Has no session! ❌
                                   └── Cannot continue conversation
```

Container A created and owns the session. Container B knows nothing about it. You could work around this with **sticky sessions** (routing all traffic from one user to the same container), but that:

- Limits scaling (one user is stuck to one container)
- Creates hotspots (popular users overload their sticky container)
- Fails on container restart (session lost)

### The Stateless Solution

The stateless pattern is simple: **write every piece of session state to an external database, and read it back on every request.**

```ascii
User msg 1 ──> Container A ──> Creates Copilot session
                              ──> Stores session ID in database
                              ──> Responds to user

User msg 2 ──> Container B ──> Reads session ID from database
                              ──> Calls copilotClient.resumeSession(storedId)
                              ──> Continues conversation seamlessly

User msg 3 ──> Container C ──> Same pattern: read from DB, resume
```

The key insight is that the Copilot SDK supports a `resumeSession()` call. If you store the SDK's internal session ID in your database after creation, any container can pick it up and resume the conversation.

Here's what that looks like in the framework's core logic:

```typescript
// Try to resume an existing Copilot session
if (session.copilot_session_id) {
  try {
    copilotSession = await copilotClient.resumeSession(
      session.copilot_session_id,
      sessionConfig
    );
  } catch {
    // Resume failed — create a new session instead
    isNewCopilotSession = true;
  }
}

// Create new session if needed (first message, or resume failed)
if (!copilotSession) {
  copilotSession = await copilotClient.createSession(sessionConfig);

  // Store the session ID for future resume by any container
  await sessionManager.updateCopilotSessionId(
    username,
    session.id,
    copilotSession.sessionId
  );
}
```

This is the same pattern that web frameworks like Express use for authentication. You don't store the user object in container memory --- you store a session ID in a cookie, and look it up in Redis or a database on every request. Apply the same idea to AI conversations.

But there's a catch we haven't discussed yet. The framework externalizes your *application-level* session state to a database --- but what about the Copilot SDK's *own* session storage?

---

## The Hidden Layer: CLI Session Storage

The stateless pattern described above handles one layer of the problem: your application's session metadata (session IDs, conversation mappings, expiration, audit records) is stored in a database that any container can access.

But there's a second layer that isn't immediately obvious. Recall that the Copilot SDK talks to the **Copilot CLI running in headless mode on a separate container** (exposed internally on port 3000). This CLI server manages the actual conversation with the AI model, and it persists its own session data --- conversation history, authentication tokens, model context --- to the **filesystem** at `/root/.copilot/session-state`.

When Container B calls `resumeSession(storedId)`, it isn't just looking up a record in your database. The CLI server on Container B needs to *find the actual session files on disk*. If each container has its own isolated filesystem (which is the default in containerized environments), this fails silently --- the database has the session ID, but the CLI server can't find the corresponding files.

### Two-Tier Persistence

This creates a two-tier persistence architecture:

```ascii
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR APPLICATION                            │
│                                                                 │
│   Tier 1 (Framework handles this):                              │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  Session metadata, conversation IDs, audit logs       │     │
│   │  ──> Database (Cosmos DB, PostgreSQL, Redis, etc.)    │     │
│   │  ──> Via ISessionStore / IAuditStore interfaces       │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                 │
│   Tier 2 (Infrastructure concern):                              │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  Copilot SDK session files (conversation history,     │     │
│   │  auth tokens, model context)                          │     │
│   │  ──> Filesystem at /root/.copilot/session-state       │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The framework gives you full control over Tier 1 via pluggable interfaces. Tier 2, however, is controlled by the Copilot SDK itself --- and it writes to the local filesystem with no option to change that behavior.

### The NFS Solution

The pragmatic solution is to give all container replicas access to the **same filesystem** using a network file share. In an Azure Container Apps deployment, this means mounting an **Azure Files share with NFS protocol** to every container instance:

```ascii
Container A ──┐
Container B ──┼──> NFS Mount (/root/.copilot/session-state) ──> Azure Files (Premium)
Container C ──┘
```

With this setup:
    - Container A creates a Copilot session --- the CLI server writes session files to the NFS mount
    - Container B receives the next request --- its CLI server reads the same session files from the same NFS mount
    - `resumeSession()` succeeds because the files are physically accessible on every replica

In the reference deployment (Azure Container Apps + Bicep), this is configured as a volume mount on the CLI server container with `NfsAzureFile` storage backed by a Premium FileStorage account. The NFS share is secured via a private endpoint within the VNet, so session data never traverses the public internet.

### Toward True Statelessness

NFS works, but it's not the ideal solution. It adds infrastructure complexity (storage account, private endpoint, VNet configuration), introduces filesystem-level latency, and creates a shared dependency that all replicas rely on.

The root cause is that the **Copilot SDK doesn't expose a pluggable interface for session persistence** at the CLI level. Unlike the framework --- which lets you implement `ISessionStore` against any database --- the CLI server is hardcoded to use the filesystem.

If the Copilot SDK were to provide a database-backed session storage interface (or even a simple key-value store abstraction), the NFS dependency could be eliminated entirely. Each container would manage CLI sessions through the database, the same way the framework already handles application-level sessions.

Until then, NFS bridges the gap. The framework gives you a stateless application layer; NFS gives you a shared CLI layer. Together, they enable true horizontal scaling.

---

## The Pattern in Practice: Copilot Agent Framework

To make these ideas concrete, I built a proof-of-concept framework that implements the stateless session pattern as a reusable library. The implementation details are less important than the pattern itself --- but seeing the code makes the pattern tangible. The framework provides three core components that work together:

| Component | Responsibility |
| --------- | -------------- |
| `SessionManager` | Session lifecycle: create, resume, expire, end |
| `AuditManager` | Logging: user queries, agent responses, tool calls |
| `CopilotService` | Orchestrator: ties sessions, audit, and Copilot SDK together |

And three interfaces you implement for your own infrastructure:

| Interface | Purpose |
| --------- | ------- |
| `ISessionStore` | Where sessions are stored (database, Redis, etc.) |
| `IAuditStore` | Where audit logs are stored |
| `IStreamHandler` | How streaming content reaches the client (SSE, WebSocket, etc.) |

### Installation

```bash
npm install @ritwikranjan/copilot-agent-framework @github/copilot-sdk
```

The framework has only two runtime dependencies (`debug` and `uuid`). `@github/copilot-sdk` is a peer dependency --- you install it yourself so you control the version.

### Quick Start

Here's the minimal setup to send a message:

```typescript
import {
  CopilotService,
  SessionManager,
  InMemorySessionStore,
  loadSystemPrompt,
} from '@ritwikranjan/copilot-agent-framework';

// 1. Create a session store (in-memory for dev, implement ISessionStore for production)
const sessionStore = new InMemorySessionStore();

// 2. Create a session manager
const sessionManager = new SessionManager({ store: sessionStore });

// 3. Create the Copilot service
const copilot = new CopilotService(
  {
    cliUrl: 'localhost:3000',
    model: 'gpt-5.2',
    agentName: 'my-agent',
    systemPrompt: loadSystemPrompt(),
  },
  sessionManager,
);

// 4. Send a message
const response = await copilot.sendMessage(
  'Hello!',
  { username: 'user@example.com', hostname: 'my-app' },
  { conversationId: 'conv-1' },
);

console.log(response.response);
```

The `InMemorySessionStore` is for development. For production, you implement the `ISessionStore` interface against your database. We'll cover that later.

---

## Deep Dive: Session Management

The `SessionManager` handles the full lifecycle of a conversation session.

### The Session Data Model

Every session is represented by a `SessionInfo` object:

```typescript
interface SessionInfo {
  id: string;                    // Unique session ID
  name?: string;                 // Optional user-provided name
  user_info: UserInfo;           // { username, hostname }
  start_time: string;            // ISO 8601 timestamp
  end_time?: string;             // Set when session ends
  status: SessionStatus;         // ACTIVE | COMPLETED | ERROR
  agent_config?: Record<string, unknown>; // Agent configuration used
  copilot_session_id?: string;   // Copilot SDK's internal session ID
  conversation_id?: string;      // Maps external conversations to sessions
  expires_at?: string;           // 12 hours from creation
  last_activity_at?: string;     // Updated on each message
}
```

The critical field is `copilot_session_id`. This is the Copilot SDK's own session identifier. When a new Copilot session is created, the framework immediately stores this ID in the database. When a different container handles the next message, it reads this ID back and calls `resumeSession()`.

### Session Resolution

When a message arrives, the framework needs to figure out: *which session does this belong to?* The `resolveSession` method handles this with a clear priority system:

1. **`sessionId` provided** --- Look up by ID directly. Must exist. Throws `SessionNotFoundError` if not.
2. **`conversationId` provided** --- Find the active session for this conversation. If none exists or it's expired, create a new one.
3. **`sessionName` provided** --- Find by name, or create a new session with that name.
4. **Nothing provided** --- Create a new unnamed session.

For most HTTP/API use cases, you'll use `conversationId`. Each conversation maps to exactly one active session, and the framework handles the lookup automatically.

### Session Expiration

Sessions expire after 12 hours by default. This is a deliberate design decision:

- The Copilot SDK's own sessions have a limited lifetime
- Long-lived sessions accumulate conversation history, increasing token usage
- Expiration provides a natural cleanup mechanism

The expiration duration is configurable via `SessionManagerOptions`:

```typescript
const sessionManager = new SessionManager({
    store: sessionStore,
    sessionExpirationMs: 4 * 60 * 60 * 1000, // 4 hours instead of the default 12
});
```

When a session expires, the framework returns a `sessionExpired: true` flag in the response, signaling your application to prompt the user to start fresh or resume.

```typescript
// Check before processing
const status = await copilot.getConversationSessionStatus(conversationId, username);

if (status.expired) {
  // Prompt user to resume or start new session
  await copilot.resumeConversationSession(conversationId, userInfo);
}
```

---

## Deep Dive: Audit Logging

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

## Deep Dive: Streaming

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

| Event | What happens |
| ----- | ------------ |
| `assistant.turn_start` | New turn begins; resets content tracking |
| `assistant.message_delta` | Content chunk emitted to client via `streamHandler.emit()` |
| `assistant.message` | Final complete message for the turn (content already streamed via deltas) |
| `assistant.reasoning_delta` | Model's thinking process (optionally shown via `update()`) |
| `assistant.reasoning` | Final complete reasoning for the turn |
| `assistant.turn_end` | Turn ends; newline separator emitted |
| `tool.execution_start` | Tool usage notification emitted to client |
| `tool.execution_progress` | Tool progress message shown to user |
| `tool.execution_complete` | Tool result logged to audit |
| `session.idle` | Streaming complete, promise resolves |
| `session.error` | Error emitted, promise rejects |

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

- **Sessions**: partitioned by `username` --- so querying all sessions for a user is a single-partition query
- **Interactions**: partitioned by `session_id` --- so querying all interactions for a session is efficient
- **Tool Executions**: partitioned by `session_id` --- same reasoning

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

Building AI agents for production is different from building a chatbot demo. When you need multiple containers, you need stateless sessions. When you need compliance, you need audit logging. When you need responsive UX, you need streaming. And you need all of these to work together without locking you into a specific web framework or cloud provider.

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
