---
"@caiquebrito/nodum-core": minor
---

Import statements now resolve into real `imports` edges connecting file nodes, for TypeScript, JavaScript, Kotlin, and Java. Previously every parser extracted import specifiers and discarded them — the graph had zero cross-file edges. Relative TS/JS imports resolve via Node-style extension + `index.*` probing; Kotlin/Java imports (including wildcards) resolve via dotted-FQN suffix-matching against known file paths, shared across both languages for mixed-language projects. Incremental sync correctly preserves an `A→B` import edge when only `B` changes, and drops it when `B` is deleted or `A`'s import statement is removed.
