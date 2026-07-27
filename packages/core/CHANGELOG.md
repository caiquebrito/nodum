# @caiquebrito/nodum-core

## 2.2.2

### Patch Changes

- 3395e22: Bump minimum supported Node.js version to 18 (Node 16 is end-of-life).
- b32a4c0: Sync now records a per-file manifest (`graph/files.json`) with content hash, mtime, and size for every discovered file. Pure additive plumbing — no change to existing sync behavior, output, or `graph.json` contents. Lays the groundwork for incremental sync.
