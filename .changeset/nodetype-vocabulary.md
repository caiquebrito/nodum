---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-mcp": minor
---

Extends `NodeType` with `struct`/`enum`/`protocol`/`extension`, laying the vocabulary groundwork for Swift and Objective-C support (specs 037-038). `Graph['stats']` gains four optional counters (`structs`/`enums`/`protocols`/`extensions`), always populated on any freshly generated graph. `search_graph`'s `type_filter` accepts the new values.

Also fixes a pre-existing gap in the 3D viewer where `interface` and `method` node types silently fell back to a generic grey color — they now have their own distinct colors, alongside the four new types.

No behavior change for existing (non-Swift/ObjC) projects: the original 5 stats keys are unaffected, and the four new counters report `0`.
