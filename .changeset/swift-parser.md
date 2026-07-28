---
"@caiquebrito/nodum-core": minor
---

Adds first-class Swift support (`.swift`) via tree-sitter: classes, structs, enums, actors, extensions, protocols, methods, `init`/`deinit`, real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and Swift module import resolution (directory-suffix matching, mirroring how JVM dotted-FQN imports already resolve — no `Package.swift`/`.xcodeproj` parsing).

`class`/`struct`/`enum`/`actor`/`extension` all parse as one grammar node in this tree-sitter grammar, disambiguated by keyword; `protocol` is a distinct node. Local (nested) functions are not extracted as their own nodes — a documented scope reduction, not a bug.

Zero changes to `graph-gen.ts` or `file-discovery.ts` — the parser plugin architecture built in the tree-sitter migration batch (specs 030-035) generalizes cleanly to a language family that shares nothing with the five parsers that existed before it.

Also switches the workspace's Vitest `pool` to `forks` — the default `threads` pool reliably crashed once enough tree-sitter grammars were JIT-compiled across a shared V8 instance; `forks` isolates each test file into its own process, fixing it.
