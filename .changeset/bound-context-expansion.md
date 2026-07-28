---
"@caiquebrito/nodum-mcp": minor
---

Fixed the largest uncontrolled token risk in `search_graph`: `expandContext()` previously added *every* 1-hop neighbor of a matched node with no cap, so a query matching a heavily-imported hub file could pull in its entire dependent list. Now capped per-seed (10 neighbors per direction) and by a hard ceiling on the total expanded set (150 nodes), built via a one-time adjacency index instead of an O(seeds × edges) rescan per seed. Measured on a deliberately hub-heavy fixture (one file with 300 dependents): 5793 → 283 `approxTokens` (spec 027, part of the v2.2.0 measurement release).

`handleAnalyzeFile`'s file-contents list and `handleExpandCluster`'s member-node/external-deps lists were also unbounded — both now cap at 20 items with an `... and N more` suffix, matching the style already used elsewhere in these handlers.

Also fixes `hasEmbeddings()`, found while testing: it returned vacuously `true` for a graph with zero non-file nodes (`0 >= 0`), which would incorrectly route an all-file graph through the semantic-search path instead of keyword search.
