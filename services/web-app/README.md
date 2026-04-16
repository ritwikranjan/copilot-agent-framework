# Copilot Web App

Next.js web chat UI for the Copilot Agent Framework. Provides a cross-platform browser-based chat interface with Microsoft Entra ID authentication, complementing the Teams bot with web access.

For high-level architecture and deployment instructions, see the [Project Root README](../../README.md).

## Features

- **Chat UI**: Real-time streaming chat with markdown rendering
- **Entra ID Authentication**: Microsoft Entra ID login with Authorization Code Flow + PKCE
- **Session Management**: Create, resume, rename sessions; view conversation history
- **Session Sharing**: Share sessions with other users (viewer/collaborator roles)
- **Multi-Session Support**: Sidebar with session list and quick switching
- **SSE Streaming**: Server-Sent Events for real-time response streaming
- **Responsive Design**: Tailwind CSS responsive layout

## Architecture

The web app acts as an authenticated frontend that proxies requests to the internal API service:

```
Browser
  ↓
Next.js App (HTTP:3001)
  ├── /                      Home page (login)
  ├── /chat                  New conversation
  ├── /chat/:sessionId       Existing conversation
  ├── /api/chat              → Proxy to API Service (SSE passthrough)
  └── /api/sessions          → Proxy to API Service
  ↓
Auth middleware (validates Entra ID JWT)
  ↓
API Service (HTTP:4000, internal)
```

### Request Flow

1. User authenticates via MSAL popup (Entra ID)
2. Browser sends requests to Next.js API routes with Bearer token
3. Server-side middleware validates JWT and extracts user identity (`oid`)
4. Authenticated request is proxied to the internal API service
5. SSE responses are piped back to the browser

## Quick Start

### Prerequisites

- Node.js 22+
- Microsoft Entra ID app registration (for authentication)

### Local Development

1. **Start all services** (recommended):

   ```bash
   # From project root
   docker-compose -f docker-compose.unified.yml up --build
   # Web app available at http://localhost:3001
   ```

2. **Standalone development** (requires API service running):

   ```bash
   cd services/web-app
   npm install
   npm run dev
   # Available at http://localhost:3001
   ```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | Yes | - | Entra ID app registration client ID |
| `NEXT_PUBLIC_ENTRA_TENANT_ID` | Yes | - | Azure AD tenant ID |
| `NEXT_PUBLIC_REDIRECT_URI` | No | `http://localhost:3001` | OAuth redirect URI |
| `API_URL` | No | `http://localhost:4000` | Internal API service URL |
| `ENTRA_TENANT_ID` | Production | - | Server-side tenant ID for JWT validation |
| `ENTRA_CLIENT_ID` | Production | - | Server-side client ID for JWT validation |

## Project Structure

```
services/web-app/
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Home page (login gate)
│   │   ├── layout.tsx         # Root layout
│   │   ├── globals.css        # Global styles
│   │   ├── chat/
│   │   │   └── [[...id]]/
│   │   │       └── page.tsx   # Chat page (new/existing/shared)
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts   # POST /api/chat — SSE proxy
│   │       └── sessions/
│   │           └── route.ts   # GET/POST /api/sessions — proxy
│   ├── components/
│   │   ├── chat-view.tsx      # Main chat interface
│   │   ├── session-list.tsx   # Sidebar session list
│   │   └── share-dialog.tsx   # Session sharing dialog
│   └── lib/
│       ├── msal.ts            # MSAL configuration (SPA auth)
│       ├── auth.ts            # Server-side JWT validation middleware
│       └── api.ts             # Browser API client (fetch + SSE)
├── Dockerfile                 # Multi-stage Next.js build
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
└── vitest.config.ts
```

## Authentication

### MSAL Configuration

The web app uses `@azure/msal-browser` for SPA authentication:

- **Flow**: Authorization Code with PKCE (popup-based)
- **Cache**: Session storage (no persistent cookies)
- **Scopes**: `openid`, `profile`, `email`

### Server-Side Validation

Next.js API routes use `withAuth()` middleware that:

1. Extracts Bearer token from `Authorization` header
2. Decodes JWT and validates `tid` (tenant ID) claim
3. Extracts `oid` (Object ID) as the username for downstream API calls
4. Returns 401 for missing/invalid tokens, 403 for wrong tenant

## Key Components

### `chat-view.tsx`

Main chat interface providing:
- Message input with send/cancel
- Streaming response display with markdown rendering
- Reasoning/thinking block toggle
- Auto-scroll during streaming

### `session-list.tsx`

Sidebar session management:
- List of user's sessions (own + shared)
- Session selection and switching
- New session creation
- Session rename and end

### `share-dialog.tsx`

Session sharing modal:
- Share with another user by username
- Role selection (viewer / collaborator)
- Revoke existing shares

## Testing

```bash
npm test              # Run unit tests
npm run test:watch    # Watch mode
npm run lint          # ESLint
```

## Deployment

The web app is deployed as a container in Azure Container Apps:

```bash
# Build image
docker build -t copilot-web-app -f services/web-app/Dockerfile .

# Or via the unified deployment script
.\scripts\deploy-unified.ps1 ... -WebImageTag latest
```

Build args for Entra ID are baked into the Next.js bundle at build time:

```dockerfile
ARG NEXT_PUBLIC_ENTRA_CLIENT_ID
ARG NEXT_PUBLIC_ENTRA_TENANT_ID
ARG NEXT_PUBLIC_REDIRECT_URI=http://localhost:3001
```

## See Also

- [API Service](../api/README.md) — Backend API that the web app proxies to
- [Teams Copilot Agent](../teams-copilot-agent/README.md) — Alternative Teams-based frontend
- [Stateless Copilot SDK](../../packages/stateless-copilot-sdk/README.md) — Core library
