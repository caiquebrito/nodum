---
"@caiquebrito/nodum-mcp": minor
---

`search_graph` accepts an optional `token_budget` parameter — context is filled greedily by relevance until the budget is spent, instead of a fixed node-count truncation. The single highest-priority section is always included even if it alone exceeds the budget.

Also fixes `type_filter` on `search_graph`, which was previously accepted but silently ignored — it now actually restricts search candidates to the given node type, while still allowing expansion into neighbors of other types for surrounding context.

`buildSmartContext`'s signature changed from positional `(query, graph, maxNodes, cache)` to `(query, graph, options)` with an `options: { maxNodes?, tokenBudget?, cache?, typeFilter? }` object — a breaking change for any direct caller of this exported function, though it's an internal MCP-package API, not a published CLI/core surface.

Second spec in the v2.8.0 "adaptive context budgeting" batch.
