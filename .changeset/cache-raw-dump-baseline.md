---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-mcp": patch
---

`search_graph` no longer rebuilds and retokenizes a full plain-text dump of the entire graph on every call just to compute the "N% fewer tokens than a full graph dump" savings footer — that value doesn't depend on the query, so it's now computed once at sync time and persisted as `graph.stats.rawDumpApproxTokens` (`buildStats()`), with `smart-context.ts` falling back to the old on-demand computation only for a graph synced by an older nodum version that doesn't have the field yet. Measured 9.08x faster (1130ms → 124ms average per call) on an 80,000-node synthetic graph.
