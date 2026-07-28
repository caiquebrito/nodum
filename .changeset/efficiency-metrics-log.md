---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-mcp": minor
---

New `appendMetricsLog()` in `nodum-core`, and a single instrumentation point in `nodum-mcp`'s tool dispatch (`packages/mcp/src/index.ts`) logging one JSONL line per MCP tool call to `~/.nodum/<project>/logs/metrics.jsonl` — tool name, project, duration, `approxTokens` (from spec 024), and success/failure. Makes token efficiency observable in real Claude Code sessions, not just the benchmark suite's fixture project (spec 025, part of the v2.2.0 measurement release).

`handlers.ts`'s `NODUM_DATA_DIR` constant is now exported rather than private, so the dispatch layer can resolve the same `~/.nodum` root without a second definition.
