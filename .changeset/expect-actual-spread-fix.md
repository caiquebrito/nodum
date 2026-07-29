---
"@caiquebrito/nodum-core": minor
---

Fixes `applyExpectActual`'s real `Maximum call stack size exceeded` crash on large real projects: clearing stale `actualizes` edges used `edges.push(...preserved)`, spreading a potentially huge array as individual call arguments — the same class of bug spec 052 already fixed once elsewhere. Replaced with an in-place filter loop. Real re-verification: the exact real ~21,447-file KMP project that surfaced this bug across specs 055/056/058 now fully syncs end to end for the first time (246,186 dependencies).
