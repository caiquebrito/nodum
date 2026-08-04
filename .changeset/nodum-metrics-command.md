---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-cli": patch
"@caiquebrito/nodum-mcp": patch
---

Add `nodum metrics [projectPath] [--json]`, reading back `~/.nodum/<project>/logs/metrics.jsonl` (written by every MCP tool call since spec 025, previously write-only) and reporting per-tool call counts, success rate, p50/p95 duration, mean approx tokens, cache-hit rate, and truncation rate. `ToolCallMetric` gains optional `query`/`resultNodeCount`/`cacheHit`/`budgetApplied`/`truncated` fields, populated by the MCP server's `withMetrics` wrapper.
