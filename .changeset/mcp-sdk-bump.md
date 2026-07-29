---
"@caiquebrito/nodum-mcp": minor
---

Bumps `@modelcontextprotocol/sdk` from `^0.7.0` to `^1.30.0`, keeping the deprecated but still-supported low-level `Server`/`setRequestHandler` API this codebase uses (the `McpServer`/`registerTool` rewrite remains a separate future investigation). Adds `zod` as an explicit dependency (now a non-optional SDK peer dependency) and adds `index.ts`'s first real test coverage.

Second of three specs in the v2.12.0 batch.
