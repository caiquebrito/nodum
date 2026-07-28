---
"@caiquebrito/nodum-core": minor
---

Adds a tree-sitter runtime (`web-tree-sitter@^0.25.10` + `tree-sitter-wasms@^0.1.13`, pinned deliberately — 0.26.x breaks ABI compatibility with these grammars, tree-sitter#5171) as the foundation for migrating the regex-based parsers to tree-sitter in upcoming releases. `Parser.parse()` is now async (`Promise<ParseResult>`) — a signature change affecting anyone implementing the `Parser` interface directly, though all five existing parsers' own behavior is unchanged (verified byte-identical graph output on an unchanged fixture project).

New `registerParser()` export lets a consumer register an additional parser at runtime instead of needing to fork `nodum-core`. `Parser` is now exported as a real class (previously type-only), so `registerParser()` is actually usable — `class MyParser extends Parser { ... }` works.

Closes three abstraction leaks: import resolution now dispatches through an optional `Parser.resolveImport()` method instead of a hardcoded extension list in `graph-gen.ts`; ignored directories (`IGNORED_DIRS`) are now contributed by each parser (`ignoredDirs?: string[]`) merged with a smaller cross-cutting base set, and additionally overridable per-project via `.nodumrc.json`'s new `ignoredDirs` key.

No language migration in this release — spec 030, first of the v2.3.0 batch.
