---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum cycles [projectPath] [--json]` — detect circular imports in a synced project. Uses Tarjan's SCC algorithm over `imports`-relation edges to find strongly-connected components of file nodes, reporting one representative cycle chain per component (not every elementary cycle, which is combinatorially expensive on tangled real codebases). `detectCycles()` is exported from `nodum-core` for reuse.
