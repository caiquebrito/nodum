---
"@caiquebrito/nodum-core": patch
---

Sync now records a per-file manifest (`graph/files.json`) with content hash, mtime, and size for every discovered file. Pure additive plumbing — no change to existing sync behavior, output, or `graph.json` contents. Lays the groundwork for incremental sync.
