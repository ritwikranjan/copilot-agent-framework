# Changelog

## 0.1.0 (2026-02-18)

### Initial Release

- `CopilotService` with synchronous and streaming message support
- `SessionManager` with stateless session lifecycle (12-hour expiration)
- `AuditManager` for interaction and tool execution logging
- `ISessionStore` and `IAuditStore` interfaces for pluggable persistence
- `InMemorySessionStore` and `InMemoryAuditStore` for development/testing
- `IStreamHandler` interface for framework-agnostic streaming
- `ILogger` interface with `debug`-based default logger
- MCP tool support via `loadToolsConfig` and `buildMcpServersConfig`
- Utility functions: `loadSystemPrompt`, `formatRemainingTime`
- Zero Azure/Teams dependencies — pure SDK wrapper
