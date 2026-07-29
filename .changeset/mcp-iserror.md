---
"@caiquebrito/nodum-mcp": patch
---

Fixes every MCP tool-call error response to be protocol-valid: handlers previously returned a bare `{ error: string }` object, which fails the MCP SDK's own `CallToolResultSchema` validation (`content` is required, `isError` is a separate optional flag) — likely surfacing to a real MCP client as a transport/parse failure instead of the actual error message. Error responses now return `{ content: [...], isError: true }`.

First of three specs in the v2.11.0 batch.
