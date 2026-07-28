---
"@caiquebrito/nodum-mcp": minor
---

`search_graph` now reports a real, computed token-savings percentage — measured against an actual full-graph-dump baseline via `estimateTokenSavings()` (unused since v2.0) and `countTokens` (spec 024) — instead of the hardcoded "40-60% fewer tokens" string. The cache-hit and semantic-search notes are now non-numeric ("served from cache", "semantic search enabled") rather than asserting unmeasured percentages ("83% more reduction", "20% better selection") that don't correspond to anything computable in the current architecture — a cache hit returns byte-identical text to a miss, so there is no separate token saving from it. `estimateTokenSavings()` also gains a zero-baseline guard to avoid `NaN%`.

README's efficiency claims are reframed the same way: real per-response numbers and the per-session `metrics.jsonl` log (spec 025) are now the source of truth, not fixed percentages (spec 026, part of the v2.2.0 measurement release).
