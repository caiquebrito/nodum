---
"@caiquebrito/nodum-mcp": minor
---

Migrates the MCP server from the deprecated low-level `Server`/`setRequestHandler` API to `McpServer`/`registerTool`. All 14 tool schemas rewritten as zod raw shapes (mechanical, no behavior change); `handlers.ts` untouched. Fixed a real TypeScript compiler limitation (`moduleResolution: "node"` vs `"bundler"`) found during implementation, scoped to this package only. Invalid-args/unknown-tool calls no longer produce a metrics log entry (now handled by the SDK before any callback runs) — a disclosed, accepted gap, verified against real server behavior.

Second of two specs in the v2.13.0 batch.
