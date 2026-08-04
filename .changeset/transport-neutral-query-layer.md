---
"@caiquebrito/nodum-mcp": patch
---

Extract `packages/mcp/src/handlers.ts`'s graph-query logic (and the `smart-context`/`embeddings`/`semantic-search`/`conversation-cache`/`graph-cache`/`identifier-tokenize` modules it depends on) into a new internal `packages/query` workspace, so a future LSP server (spec 072+) can call the same query layer without depending on `@caiquebrito/nodum-mcp` or the MCP SDK. `packages/mcp/src/index.ts` is now a thin adapter — MCP tool registration and `withMetrics` wrapping only, calling into `@caiquebrito/nodum-query` for everything else. Pure refactor, no user-facing behavior change: the full pre-existing test suite passes with the same assertions, just relocated (plus two new smoke tests guarding against regressing query logic back into `packages/mcp`).
