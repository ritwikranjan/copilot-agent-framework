# @ritwikranjan/copilot-agent-framework

Framework-agnostic library for building stateless agents on top of the GitHub Copilot SDK. Provides session management, audit logging, streaming, and pluggable persistence — with zero Azure or Teams dependencies. Built for horizontal scaling.

## Installation

```bash
npm install @ritwikranjan/copilot-agent-framework @github/copilot-sdk
```

Or as a workspace dependency (within this monorepo):

```json
{
  "dependencies": {
    "@ritwikranjan/copilot-agent-framework": "*"
  }
}
```

## Quick Start

```typescript
import {
  CopilotService,
  SessionManager,
  InMemorySessionStore,
  loadSystemPrompt,
} from '@ritwikranjan/copilot-agent-framework';

// 1. Create a session store (in-memory for dev, or your own DB implementation)
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

### Streaming

```typescript
import type { IStreamHandler } from '@ritwikranjan/copilot-agent-framework';

// Implement the generic stream handler for your framework
const streamHandler: IStreamHandler = {
  emit: (content) => process.stdout.write(content),
  update: (status) => console.log(`Status: ${status}`),
};

await copilot.sendMessageStreaming(
  'Write a poem',
  { username: 'user@example.com', hostname: 'my-app' },
  streamHandler,
  { conversationId: 'conv-1' },
);
```

### With Audit Logging

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
    enableAudit: true,
  },
  sessionManager,
  auditManager, // optional third argument
);
```

### Logging

The library is **silent by default** — no console.log output. Logs use the [`debug`](https://www.npmjs.com/package/debug) package under the hood.

**Enable via environment variable:**

```bash
DEBUG=copilot:*              # All logs
DEBUG=copilot:session        # Session manager only
DEBUG=copilot:audit          # Audit manager only
DEBUG=copilot:service        # CopilotService only
```

**Or inject a custom logger:**

```typescript
import { setLogger } from '@ritwikranjan/copilot-agent-framework';

// Route all SDK logs through your app's logger (e.g., winston, pino)
setLogger({
  debug: (msg, ...args) => myLogger.debug(msg, ...args),
  info:  (msg, ...args) => myLogger.info(msg, ...args),
  warn:  (msg, ...args) => myLogger.warn(msg, ...args),
  error: (msg, ...args) => myLogger.error(msg, ...args),
});
```

You can also pass a logger per-component:

```typescript
const sessionManager = new SessionManager({ store: myStore, logger: myLogger });
const auditManager = new AuditManager({ store: myStore, logger: myLogger });
const copilot = new CopilotService({ ...config, logger: myLogger }, sessionManager);
```

## API Reference

### CopilotService

The main class for interacting with the Copilot SDK.

```typescript
new CopilotService(config, sessionManager, auditManager?)
```

| Method | Description |
| --- | --- |
| `getConfig()` | Returns current service configuration |
| `sendMessage(message, userInfo, options?)` | Send a synchronous message, returns `CopilotResponse` |
| `sendMessageStreaming(message, userInfo, streamHandler, options?)` | Send a message with streaming via `IStreamHandler` |
| `getConversationSessionStatus(conversationId, username)` | Check session status |
| `endConversationSession(conversationId, username)` | End a session |
| `resumeConversationSession(conversationId, userInfo)` | Resume an expired session |

#### CopilotServiceConfig

```typescript
interface CopilotServiceConfig {
  cliUrl: string;           // CLI server URL (e.g., 'localhost:3000')
  model: string;            // Model name (e.g., 'gpt-5.2')
  agentName: string;        // Agent identifier
  systemPrompt?: string;    // System prompt content
  mcpServers?: MCPServerConfig[];  // MCP server configurations
  enableAudit?: boolean;    // Enable audit logging (default: true)
  logger?: ILogger;         // Custom logger (default: debug-based, silent)
}
```

### SessionManager

Manages session lifecycle with pluggable persistence. Sessions expire after 12 hours by default.

```typescript
new SessionManager({ store: ISessionStore })
```

Configure a custom session expiration:

```typescript
const sessionManager = new SessionManager({
    store: sessionStore,
    sessionExpirationMs: 4 * 60 * 60 * 1000, // 4 hours (default: 12 hours)
});
```

| Method | Description |
| --- | --- |
| `resolveSession(userInfo, options?)` | Find or create a session |
| `getSessionStatus(username, conversationId)` | Check session expiration status |
| `updateCopilotSessionId(username, sessionId, copilotSessionId)` | Store SDK session ID for resume |
| `touchSession(username, sessionId)` | Update last activity timestamp |
| `renameSession(username, sessionId, newName)` | Rename a session |
| `endSession(username, sessionId, status?)` | End a session |
| `endSessionByConversationId(username, conversationId, status?)` | End by conversation ID |
| `getSession(username, sessionId)` | Get session by ID |
| `getUserSessions(username)` | List all user sessions |

### AuditManager

Logs interactions and tool executions within a session.

```typescript
new AuditManager({ store: IAuditStore })
```

| Method | Description |
| --- | --- |
| `setSession(sessionId)` | Set active session for logging |
| `startInteraction(userQuery)` | Log start of user turn |
| `completeInteraction(response?, reasoning?)` | Log agent response |
| `logToolStart(toolName, args?)` | Log tool execution start |
| `logToolComplete(toolId, result?, error?)` | Log tool execution completion |
| `logToolExecution(toolName, args?, result?, error?)` | Log full tool execution in one call |
| `getSessionInteractions()` | Query interactions for current session |
| `getSessionToolExecutions()` | Query tool executions for current session |

### Interfaces

#### ISessionStore

Implement this to use your own database for session persistence:

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

#### IAuditStore

Implement this to use your own database for audit logging:

```typescript
interface IAuditStore {
  initialize(): Promise<void>;
  createInteraction(data: Interaction): Promise<Interaction>;
  updateInteraction(id: string, partitionKey: string, data: Interaction): Promise<Interaction>;
  getInteractionsBySession(sessionId: string): Promise<Interaction[]>;
  createToolExecution(data: ToolExecution): Promise<ToolExecution>;
  updateToolExecution(id: string, partitionKey: string, data: ToolExecution): Promise<ToolExecution>;
  getToolExecutionsBySession(sessionId: string): Promise<ToolExecution[]>;
  getToolExecutionsByInteraction(sessionId: string, interactionId: string): Promise<ToolExecution[]>;
}
```

#### IStreamHandler

Implement this to adapt streaming to your framework:

```typescript
interface IStreamHandler {
  emit(content: string): void;      // Emit content chunk
  update?(status: string): void;    // Optional status update
}
```

### Built-in Stores

| Store | Description |
| --- | --- |
| `InMemorySessionStore` | In-memory session store for development and testing |
| `InMemoryAuditStore` | In-memory audit store for development and testing |

Both stores provide `clear()` and `getCounts()` helpers for test setup/teardown.

> **Note:** `IAuditDataStore` (combined `ISessionStore & IAuditStore`) is **deprecated**. Always implement the interfaces separately. The Teams Copilot Agent uses `SessionCosmosStore` and `AuditCosmosStore` as separate classes.

### Utility Functions

| Function | Description |
| --- | --- |
| `loadSystemPrompt(options?)` | Load system prompt from env var or file paths |
| `loadToolsConfig(options?)` | Load MCP tools configuration from JSON file |
| `buildMcpServersConfig(toolsConfig, extraEnv?)` | Convert tools config to SDK format |
| `formatRemainingTime(remainingMs)` | Format milliseconds as `"Xh Ym"` |

### Models

| Type | Description |
| --- | --- |
| `UserInfo` | User identity (`username`, `hostname`) |
| `SessionInfo` | Session metadata with expiration, conversation ID, SDK session ID |
| `Interaction` | User query + agent response within a session |
| `ToolExecution` | Tool call metadata (name, args, result, timing) |
| `CopilotResponse` | Standard response envelope with success/error/session info |
| `SessionStatus` | Enum: `ACTIVE`, `COMPLETED`, `ERROR` |
| `ToolExecutionStatus` | Enum: `STARTED`, `COMPLETED`, `ERROR` |

## Example: Building an HTTP API

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

const sessionStore = new InMemorySessionStore();
const auditStore = new InMemoryAuditStore();
const sessionManager = new SessionManager({ store: sessionStore });
const auditManager = new AuditManager({ store: auditStore });

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

// POST /chat — synchronous
app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  const userInfo = { username: 'api-user', hostname: 'http' };
  const response = await copilot.sendMessage(message, userInfo, { conversationId });
  res.json(response);
});

// POST /chat/stream — streaming via SSE
app.post('/chat/stream', async (req, res) => {
  const { message, conversationId } = req.body;
  const userInfo = { username: 'api-user', hostname: 'http' };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const streamHandler = {
    emit: (content: string) => res.write(`data: ${JSON.stringify({ content })}\n\n`),
    update: (status: string) => res.write(`data: ${JSON.stringify({ status })}\n\n`),
  };

  const response = await copilot.sendMessageStreaming(message, userInfo, streamHandler, { conversationId });
  res.write(`data: ${JSON.stringify({ done: true, ...response })}\n\n`);
  res.end();
});

app.listen(3000);
```

## Testing

```bash
npm test           # Run tests
npm run test:watch # Watch mode
npm run build      # Build the package
```

## Publishing to npm

The package is structured for direct publishing:

```bash
npm run build
npm publish --access public
```

## License

MIT
