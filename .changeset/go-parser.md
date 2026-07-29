---
"@caiquebrito/nodum-core": minor
---

Adds first-class Go support (`.go`) via tree-sitter: structs, interfaces, top-level functions, methods (attributed to their receiver's struct — including across files, when a type and its method live in different files of the same package), real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and package-path import resolution (directory-suffix matching against known files — no `go.mod` parsing).

Zero changes to `graph-gen.ts` or `file-discovery.ts` — the parser plugin architecture generalizes cleanly to Go with no changes outside the new parser itself.

First of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).
