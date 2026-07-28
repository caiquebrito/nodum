# @caiquebrito/nodum-core

## 2.6.0

### Minor Changes

- fb2299d: Adds same-file `calls` edges: a function/method that calls another function/method defined in the same file (via a bare identifier, e.g. `foo()`) now gets a `calls` edge to it in the graph. Qualified calls (`this.x()`, `self.x()`, `obj.x()`) are deliberately not resolved — without real type information there's no reliable way to tell whether the receiver refers to something in this file. Implemented for TypeScript, Python, Java, and JavaScript; Kotlin stays on its regex parser and is excluded this release.

  This is the prerequisite spec 012 deferred symbol-level dead code on — existing analyzers (`cycles`, `dead-code`, `architecture`, `trace-impact`) are unchanged and continue to operate on `imports` edges only.

  Both viewer copies now render `calls` edges with a distinct color/arrowhead from `defines` edges.

- fb2299d: Migrates the Java parser from line-regex to tree-sitter. The old method regex needed a `CONTROL_FLOW_WORDS` guard just to avoid matching `} else if (...)` as a method named `if` — its own comment admitted the fix wasn't exhaustive — and missed constructors entirely (`public Foo(int x)` doesn't match a "two words before the paren" pattern once `public` is consumed as a modifier). Both are now structurally impossible rather than patched around.

  Constructors are now extracted (as `method`-type nodes labeled with the class name). Methods and constructors are attributed to their class or interface (`classId -> methodId` edge) instead of flattened to the file. Real cyclomatic complexity, including a ternary (previously excluded across all three regex-scored languages, spec 014) and two node types the old regex never distinguished: enhanced-for (`for (T x : xs)`) and do-while. Real `duplicateHash`. Import resolution (`resolveJvmImport`, shared with Kotlin) is unchanged.

  Spec 032, third of the v2.3.0 tree-sitter migration batch.

- fb2299d: Migrates the JavaScript parser from line-regex to tree-sitter. Two previously-undetected bugs fixed: `javascript.ts` never set a `line` number on any node (computed one internally purely to feed the old brace-matching helper, then discarded it — the only one of the four regex parsers with this gap, and untested since nothing anywhere in this codebase asserted line numbers before now), and JS classes got zero member extraction at all.

  Class methods (instance, static — all the same node type in this grammar) are now attributed to their class (`classId -> methodId` edge), matching the precedent Python (031) and Java (032) already established. Real cyclomatic complexity, now including a ternary and correctly distinguishing `for...of`/`for...in` from a C-style `for`. Real `duplicateHash`. A concise-body arrow function (`x => x + 1`) deliberately still gets no complexity/hash, same as before this migration — there's no brace-delimited body to walk.

  Spec 033, last of the three language migrations in the v2.3.0 tree-sitter batch — TypeScript stays on the compiler API throughout.

- fb2299d: Migrates the Python parser from line-regex to tree-sitter. Python previously had no real import extraction at all — the loop existed but its body was dead code, so every Python project silently produced zero cross-file `imports` edges while `nodum sync` reported success. It now resolves absolute (`import os.path`, `from os import x`), package (`from pkg import x` → `pkg/__init__.py`), and relative (`from . import sibling`, `from .pkg import x`) imports into real edges via new `resolvePythonImport()`.

  Also adds real cyclomatic complexity (including ternaries — the old regex-based scorer deliberately excluded them across all three of its languages to dodge a Kotlin false-positive that doesn't apply to a tree-sitter-based parser) and `duplicateHash` for Python for the first time, fixes a class/function name collision from a shared name-tracking set, fixes `async def` never matching the old `^\s*def` regex anchor, and attributes class methods to their class (`type: 'method'`, `classId -> methodId` edge) instead of flattening them into file-level `function` nodes.

  Spec 031, second of the v2.3.0 tree-sitter migration batch.

- fb2299d: Adds a tree-sitter runtime (`web-tree-sitter@^0.25.10` + `tree-sitter-wasms@^0.1.13`, pinned deliberately — 0.26.x breaks ABI compatibility with these grammars, tree-sitter#5171) as the foundation for migrating the regex-based parsers to tree-sitter in upcoming releases. `Parser.parse()` is now async (`Promise<ParseResult>`) — a signature change affecting anyone implementing the `Parser` interface directly, though all five existing parsers' own behavior is unchanged (verified byte-identical graph output on an unchanged fixture project).

  New `registerParser()` export lets a consumer register an additional parser at runtime instead of needing to fork `nodum-core`. `Parser` is now exported as a real class (previously type-only), so `registerParser()` is actually usable — `class MyParser extends Parser { ... }` works.

  Closes three abstraction leaks: import resolution now dispatches through an optional `Parser.resolveImport()` method instead of a hardcoded extension list in `graph-gen.ts`; ignored directories (`IGNORED_DIRS`) are now contributed by each parser (`ignoredDirs?: string[]`) merged with a smaller cross-cutting base set, and additionally overridable per-project via `.nodumrc.json`'s new `ignoredDirs` key.

  No language migration in this release — spec 030, first of the v2.3.0 batch.

### Patch Changes

- fb2299d: Consolidates duplicated `Graph`/`Node`/`Edge` type declarations. `packages/core/src/analyzer/clustering.ts`, `packages/mcp/src/embeddings.ts`, and `packages/mcp/src/smart-context.ts` now import these types from `@caiquebrito/nodum-core` instead of hand-redeclaring an approximation of them. `packages/mcp/src/handlers.ts`'s local `Graph` type (which used `type: string` instead of the real `NodeType`, papered over with an `as unknown as CoreGraph` cast at five call sites) is removed entirely along with all five casts.

  Fixes a stale doc comment claiming 1536-dim embeddings — the real model is 384-dim. Pure type consolidation with no intended behavior change; verified via a real end-to-end sync exercising every previously-cast handler.

## 2.5.0

### Minor Changes

- 95fd195: New `appendMetricsLog()` in `nodum-core`, and a single instrumentation point in `nodum-mcp`'s tool dispatch (`packages/mcp/src/index.ts`) logging one JSONL line per MCP tool call to `~/.nodum/<project>/logs/metrics.jsonl` — tool name, project, duration, `approxTokens` (from spec 024), and success/failure. Makes token efficiency observable in real Claude Code sessions, not just the benchmark suite's fixture project (spec 025, part of the v2.2.0 measurement release).

  `handlers.ts`'s `NODUM_DATA_DIR` constant is now exported rather than private, so the dispatch layer can resolve the same `~/.nodum` root without a second definition.

- 902037f: New `countTokens(text): number` exported from `nodum-core` — an approximate, offline token count (via `js-tiktoken`'s `o200k_base` encoding) for text, since Claude's real tokenizer isn't public. Named `approxTokens` everywhere it surfaces, deliberately not `tokens`, to avoid repeating the precision the codebase previously asserted without measuring (spec 024 kicks off the v2.2.0 measurement release).

  `buildSmartContext()` in `nodum-mcp` now returns `{ text, approxTokens }` instead of a bare string — pure instrumentation, MCP response bodies are unchanged. A later spec in this series (026) uses `approxTokens` to replace the hardcoded "40-60% fewer tokens" claims with real numbers.

## 2.4.0

### Minor Changes

- 30af362: `nodum sync`/`nodum init` and the MCP server now check npm once a day for a newer published version and print a one-line update notice to stderr if you're behind — set `NODUM_NO_UPDATE_CHECK=1` (or `CI=true`) to disable. Also fixes both the CLI's `--version` and the MCP server's reported version, which were hardcoded to a stale `1.0.0` placeholder instead of their real published versions.

## 2.3.0

### Minor Changes

- d869063: `nodum architecture [projectPath] [--json] [--rule <from>:<to>]` — detect `imports` edges that violate declared layer rules (e.g. `ui:repo` disallows the `ui` group importing the `repo` group), using each node's existing group classification. Deny-list only, opt-in, with `*` wildcard support. Persist rules via `nodum config --set-architecture-rules <from>:<to>,...`, stored in `.nodumrc.json` under a new `architecture.rules` key. `detectArchitectureViolations()`/`loadArchitectureConfig()`/`saveArchitectureConfig()` are exported from `nodum-core` for reuse.

  Also fixes a latent bug in `saveScanConfig`: it previously round-tripped through only its own typed fields, silently deleting any other top-level key in `.nodumrc.json` (like the new `architecture` key) on the next `--set-include`/`--set-exclude`. It now merges into the raw JSON instead.

- b0ce5cf: Real `.gitignore` support (the `ignore` package was a dependency this whole time but never wired up) and `.nodumrc.json` include/exclude patterns via a new `nodum config` command. Also fixes `.go`/`.rs`/`.rb` extensions being discovered and counted in sync stats despite having no parser — the supported-extension list is now derived from the registered parsers themselves instead of a separately-maintained hardcoded list, so this can't drift again. Excluded directories now stop the file walk from recursing into them entirely, not just filter their contents afterward.
- ddbafe2: `nodum diff <a> <b> [--json]` — compare two graph snapshots (file paths, e.g. from `nodum export --format json`, or synced project names) and report added/removed/changed nodes, added/removed edges, and stat deltas. `diffGraphs()` is exported from `nodum-core` for reuse. Deliberately excludes `clusterId` (positional, renumbered every sync) and `embedding` (MCP-only enrichment) from change detection to avoid noisy false positives.
- 8273296: `nodum duplicates [projectPath] [--json]` — finds functions/methods that are structurally near-identical (same control-flow shape, robust to variable renaming and literal-value changes), computed at parse time as a new optional `Node.duplicateHash` field. TypeScript is normalized precisely via its real AST; JavaScript/Kotlin/Java use a new shared regex-based tokenizer built on spec 014's brace-body extraction. A 20-token minimum avoids flooding output with trivial one-liner "duplicates." `detectDuplicates()` is exported from `nodum-core` for reuse. Scoped to Type-2-style exact-structural matching within a single language — Type-3 (near-matches with inserted/deleted statements) and cross-language matching are both out of scope.
- 050e677: `nodum complexity [projectPath] [--json] [--threshold N]` — ranks functions/methods by cyclomatic complexity (McCabe), computed at parse time and stored as a new optional `Node.complexity` field. TypeScript is computed precisely from its real AST; JavaScript/Kotlin/Java use a new shared brace-matching body-extraction helper plus regex-based decision-point counting (deliberately excluding ternary for these three languages — a false-positive risk in Kotlin's nullable-type syntax). Python and cognitive complexity are both out of scope for now. `rankByComplexity()` is exported from `nodum-core` for reuse.

  Also fixes a real pre-existing bug in the Java parser's method-detection regex, caught while verifying this spec against real code: `} else if (...)` was mis-parsed as a method declaration named `if`.

- c6bcd9f: `nodum dead-code [projectPath] [--json] [--entry <patterns>]` — find files no other tracked file imports, as candidates for dead-code review (not a definitive verdict — a real entry point wired up outside the parsed import graph looks identical to an orphan). Excludes test-group files and files matching a built-in entry-point-name heuristic (`index.*`, `main.*`, `*.config.*`, etc.), extensible via `--entry` for framework-specific routing conventions. `detectUnreachableFiles()` is exported from `nodum-core` for reuse. Scoped to file-level reachability only — the graph has no call/reference edges yet, so symbol-level (unused function/class) detection isn't feasible today.
- c288b9c: `nodum cycles [projectPath] [--json]` — detect circular imports in a synced project. Uses Tarjan's SCC algorithm over `imports`-relation edges to find strongly-connected components of file nodes, reporting one representative cycle chain per component (not every elementary cycle, which is combinatorially expensive on tangled real codebases). `detectCycles()` is exported from `nodum-core` for reuse.
- 1a8580d: Import statements now resolve into real `imports` edges connecting file nodes, for TypeScript, JavaScript, Kotlin, and Java. Previously every parser extracted import specifiers and discarded them — the graph had zero cross-file edges. Relative TS/JS imports resolve via Node-style extension + `index.*` probing; Kotlin/Java imports (including wildcards) resolve via dotted-FQN suffix-matching against known file paths, shared across both languages for mixed-language projects. Incremental sync correctly preserves an `A→B` import edge when only `B` changes, and drops it when `B` is deleted or `A`'s import statement is removed.
- 4fe1527: `nodum sync --incremental` now actually skips re-reading and re-parsing files that haven't changed since the last sync, using the `graph/files.json` manifest — `discoverChangedFiles()` stat-checks every file first and only reads/hashes ones that look different, and `generateGraph()` evicts and re-parses only the changed set instead of doing a full rescan. Falls back silently to a full sync if there's no previous sync to diff against. Non-incremental `nodum sync` is unchanged.
- 7d502bf: New `explain_architecture` MCP tool and companion `nodum explain-architecture [projectPath] [--json]` CLI command: auto-generates an architecture overview — which layers (groups) exist, aggregate `imports` counts between every layer pair (including self-pairs), and any violations of the project's declared architecture rules (spec 013's `detectArchitectureViolations`, reused directly). The MCP tool automatically loads a project's `.nodumrc.json` rules via the existing `projects.json` index. `explainArchitecture()` is exported from `nodum-core` for reuse.
- 98a0fe6: New `find_bottlenecks` MCP tool and companion `nodum bottlenecks [projectPath] [--json] [--limit N]` CLI command: ranks files by a composite bottleneck score combining code complexity (spec 014) with how many other files transitively depend on them (spec 016's `traceImpact`). A highly complex file nobody depends on ranks lower than a moderately complex one many files import — `score = maxComplexity × (1 + dependentCount)`. Both raw components are returned alongside the score for auditability. `findBottlenecks()` is exported from `nodum-core` for reuse; composes existing analyzers rather than adding new graph-traversal logic.
- bb1838d: New `find_similar_code` MCP tool and companion `nodum similar-code <projectPath> <nodeId> [--json]` CLI command: finds other functions/methods structurally near-identical to a given node. A thin, node-scoped lookup on top of spec 015's `detectDuplicates` (reused directly, not re-implemented) — "what's similar to this" rather than a global duplication report. `findSimilarCode()` is exported from `nodum-core` for reuse.
- 595cfe1: New `suggest_refactoring` MCP tool and companion `nodum suggest-refactoring [projectPath] [--json] [--complexity-threshold N]` CLI command: a capstone synthesis of every analysis capability shipped in this series — circular imports (011), dead files (012), architecture-rule violations (013), overly complex functions (014, default threshold 10), and duplicated code (015) — into one unified suggestion feed, grouped in a fixed category order. Zero new detection logic; pure composition of existing analyzers, reused directly. `suggestRefactoring()` is exported from `nodum-core` for reuse.

  This closes out the v2.1.0 "Advanced Graph Analysis" and "MCP Enhancements" roadmap sections (specs 010–020).

- fe1b080: New `trace_impact` MCP tool and companion `nodum trace-impact <projectPath> <nodeId> [--max-depth N] [--json]` CLI command: shows every file transitively affected by changing a given file/function/class — the cascade of changes if you modify X. Walks incoming `imports` edges via BFS, cycle-safe, resolving function/method/class nodes to their owning file first (the graph has no call/reference edges, so per-function impact within an affected file isn't determined — only which files transitively depend on it). `traceImpact()` is exported from `nodum-core` for reuse. Distinct from the existing `get_dependents` tool, which is one-hop only.

### Patch Changes

- 878f510: `nodum watch [projectPath]` — watches a project and automatically runs an incremental sync on file changes (debounced, default 500ms, configurable via `--debounce`). Reuses the same `.gitignore`/`.nodumrc.json` rules as `nodum sync`/`nodum config`. Exports `IGNORED_DIRS` from `nodum-core` so watch mode can skip watching `node_modules`, `.git`, etc. at the filesystem level.

## 2.2.2

### Patch Changes

- 3395e22: Bump minimum supported Node.js version to 18 (Node 16 is end-of-life).
- b32a4c0: Sync now records a per-file manifest (`graph/files.json`) with content hash, mtime, and size for every discovered file. Pure additive plumbing — no change to existing sync behavior, output, or `graph.json` contents. Lays the groundwork for incremental sync.
