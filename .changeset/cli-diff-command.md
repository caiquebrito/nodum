---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum diff <a> <b> [--json]` — compare two graph snapshots (file paths, e.g. from `nodum export --format json`, or synced project names) and report added/removed/changed nodes, added/removed edges, and stat deltas. `diffGraphs()` is exported from `nodum-core` for reuse. Deliberately excludes `clusterId` (positional, renumbered every sync) and `embedding` (MCP-only enrichment) from change detection to avoid noisy false positives.
