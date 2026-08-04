---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-mcp": patch
---

Enrich node embedding text with graph context instead of just `"<label> <type>"` (e.g. `authenticateUser function`). `generateNodeEmbedding` now embeds the identifier-split label, type, file basename, and — when present — module/layer/sourceSet, plus up to 5 outgoing call targets and up to 5 incoming callers, all built from adjacency maps constructed once per sync rather than per node. Label splitting reuses the shared `tokenizeIdentifier` utility (spec 068) instead of a second copy. Adds `Graph.embeddingVersion`; `hasEmbeddings()` now treats a missing or stale version as "not embedded" so an old graph.json's embeddings never get silently compared against a query embedded with the new text.
