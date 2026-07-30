---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
"@caiquebrito/nodum-mcp": minor
---

Fixes the real Node `v25.9.0` crash (`Fatal process out of memory: Zone`) that has affected very large project syncs since spec 055 (v2.12.0). Root-caused via a real native stack trace to a genuine bug in V8's Turboshaft WASM optimizing compiler when compiling a tree-sitter grammar module — confirmed by elimination against real, measured V8 flags. `--liftoff-only` (forcing baseline-only WASM compilation) avoids it entirely; since neither `NODE_OPTIONS` nor a runtime `v8.setFlagsFromString()` call can apply this flag (both verified not to work), `nodum` and `nodum-mcp` now transparently re-exec themselves with it. Real check: the exact real ~21,447-file KMP project that crashed in ~3 seconds now completes end to end with zero manual flags — 246,186 dependencies, matching every prior successful run exactly.
