# @caiquebrito/nodum-core

## 2.16.0

### Minor Changes

- 3ef9c1c: Fixes the real Node `v25.9.0` crash (`Fatal process out of memory: Zone`) that has affected very large project syncs since spec 055 (v2.12.0). Root-caused via a real native stack trace to a genuine bug in V8's Turboshaft WASM optimizing compiler when compiling a tree-sitter grammar module — confirmed by elimination against real, measured V8 flags. `--liftoff-only` (forcing baseline-only WASM compilation) avoids it entirely; since neither `NODE_OPTIONS` nor a runtime `v8.setFlagsFromString()` call can apply this flag (both verified not to work), `nodum` and `nodum-mcp` now transparently re-exec themselves with it. Real check: the exact real ~21,447-file KMP project that crashed in ~3 seconds now completes end to end with zero manual flags — 246,186 dependencies, matching every prior successful run exactly.

## 2.15.0

### Minor Changes

- deb21f3: Fixes `applyExpectActual`'s real `Maximum call stack size exceeded` crash on large real projects: clearing stale `actualizes` edges used `edges.push(...preserved)`, spreading a potentially huge array as individual call arguments — the same class of bug spec 052 already fixed once elsewhere. Replaced with an in-place filter loop. Real re-verification: the exact real ~21,447-file KMP project that surfaced this bug across specs 055/056/058 now fully syncs end to end for the first time (246,186 dependencies).

## 2.14.0

## 2.13.0

### Minor Changes

- 61d00ca: Fixes a real resource leak: every tree-sitter-backed parser (Python, Java, JavaScript, Kotlin, Go, Swift, Objective-C) creates a fresh `TSParser` instance per file but never freed it — only the parsed tree was deleted. On a large real project this leaks thousands of WASM parser instances. Real re-verification found this fix alone does not resolve a known large-project sync crash on some Node/V8 builds (confirmed Node-version-specific, with a separate stack-overflow bug also found in the process) — see ROADMAP.md for the full, honest account.

  First of two specs in the v2.13.0 batch.

## 2.12.0

### Minor Changes

- d949b11: Detects Kotlin `expect`/`actual` declarations and links each `actual` to the `expect` it fulfills via a new `actualizes` edge. Matches within the same Gradle module, by declaration kind and name, validated against Kotlin's default source-set hierarchy (`androidMain`/`iosMain`/`jvmMain` → `commonMain`). No `settings.gradle` parsing needed — confirmed unnecessary since real KMP projects rely on Kotlin's implicit default hierarchy template rather than declaring source-set dependencies explicitly.

  Third of three specs in the v2.12.0 batch.

## 2.11.0

### Minor Changes

- 97f89ab: Labels Gradle modules (`forro/feature`, `app`, ...) on `Node.module`, derived purely from file path convention — no `settings.gradle` parsing needed. `mcp get_node` shows a `Module:` line when present. Also removes the confirmed-dead `readSettingsGradle` from `config-reader.ts`.

  Second of three specs in the v2.11.0 batch.

- 31d9c86: Adds all-pairs near-duplicate grouping across a whole project: `nodum duplicates --fuzzy` and a new `near-duplication` category in `suggest_refactoring`. Groups are quasi-cliques (every member pairwise-similar to every other member above the threshold), not transitively-chained — real-scale verification found single-linkage transitive closure merges thousands of unrelated functions into one meaningless group on a large real project.

  Third of three specs in the v2.11.0 batch.

## 2.10.0

### Minor Changes

- edbdbce: Fixes a real stack-detection gap: `readBuildGradle`/`readSettingsGradle` only ever read the plain `.gradle` (Groovy) filenames, never `.gradle.kts`/`settings.gradle.kts` (Kotlin DSL) — modern Kotlin/Android projects using the Kotlin DSL went completely undetected (`languages`/`frameworks`/`buildTools` all empty). Also fixes framework detection (`androidx.compose`) in multi-module projects, where plugin markers commonly live in a module's own build file, not the root's.

  New `Node.sourceSet` field, path-convention-derived (`commonMain`, `androidMain`, `test`, ...) — surfaced in MCP's `get_node` output when present.

  Fourth and final spec in the v2.10.0 batch.

- 200cc79: `find_similar_code`/`nodum similar-code` is now genuinely fuzzy — previously it only matched exact structural duplicates (byte-for-byte identical normalized token streams). It now also finds near-duplicates (the same logic with a branch added, a minor refactor) via a new MinHash-style similarity signature computed at parse time across all 8 supported languages, with no new dependency. Exact matches still take precedence and are unaffected.

  New `Node.similaritySignature` field (additive, alongside the existing `duplicateHash`). CLI gains `--threshold`/`--limit` flags; MCP's `find_similar_code` gains an optional `threshold` parameter. The default threshold (0.65) was calibrated against real code, not asserted — see spec 048's spec doc for the calibration data.

  Third of four specs in the v2.10.0 batch.

## 2.9.0

### Minor Changes

- 88c2842: Adds cognitive complexity (SonarSource-inspired) as a second complexity metric alongside the existing cyclomatic (McCabe) one, across all 8 supported languages — nesting-depth-aware, so a deeply-nested `if` costs more than the same count of sequential `if`s, unlike cyclomatic complexity. New `Node.cognitiveComplexity` field, set alongside the existing `complexity` field, never replacing it.

  `rankByComplexity` gains an optional `metric: 'cyclomatic' | 'cognitive'` (defaults to `'cyclomatic'`, unchanged behavior); CLI's `nodum complexity` gains a `--cognitive` flag. `find_bottlenecks`/`suggest_refactoring` are unchanged — both keep using cyclomatic complexity by default.

  Third and final spec in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).

- 9864c49: Adds first-class Go support (`.go`) via tree-sitter: structs, interfaces, top-level functions, methods (attributed to their receiver's struct — including across files, when a type and its method live in different files of the same package), real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and package-path import resolution (directory-suffix matching against known files — no `go.mod` parsing).

  Zero changes to `graph-gen.ts` or `file-discovery.ts` — the parser plugin architecture generalizes cleanly to Go with no changes outside the new parser itself.

  First of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).

- 1a65311: Migrates Kotlin from line-regex to tree-sitter, gaining real `method` nodes (class/interface members are now properly attributed instead of flat file-attached functions colliding on same-named methods across classes), same-file `calls` edges, a dedicated `enum` node type, real complexity/`duplicateHash` for expression-bodied functions, and fixes a real gap where extension functions (`fun String.slugify()`) were silently never extracted at all by the old regex parser.

  Cyclomatic complexity now also counts non-default `when` entries (never matched by the old regex) and `elvis_expression` (`?:`) — previously excluded as a text-matching workaround that a real AST makes unnecessary, matching Swift's `??` precedent.

  Import resolution (`resolveJvmImport`, dotted-FQN + wildcard specifier format) is unchanged — every pre-existing import test passes unmodified, this migration's explicit contract.

  Second of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).

## 2.8.0

### Minor Changes

- 4134bf4: File discovery (`discoverFiles`/`discoverChangedFiles`) now reads/hashes files with bounded concurrency instead of sequentially — a real wall-clock win on larger projects, with byte-identical output (verified against a frozen real-project snapshot, including cluster assignment).

  Adds file-size and file-count sync guardrails, configurable via `.nodumrc.json`: `maxFileSizeBytes` (default 2 MB) excludes an oversized file individually with a warning rather than reading/parsing it; `maxFilesWarning` (default 20,000) warns once a project's file count crosses the threshold, without truncating the sync. Warnings surface through the CLI (`console.warn`) and the MCP server's `sync_project` response text.

  Also fixes a latent tree-sitter parser safety issue: `TreeSitterParser` no longer memoizes a single shared `TSParser` per instance for its whole lifetime — each parse now gets its own `TSParser` bound to the already-shared, genuinely-immutable `Language`, matching what the underlying grammar loader was already doing correctly. WASM-allocated parse trees are now freed (`tree.delete()`) once node/edge extraction completes, across all 5 tree-sitter-backed languages (Python, Java, JavaScript, Swift, Objective-C).

  Third and final spec in the v2.8.0 "adaptive context budgeting" batch.

## 2.7.0

### Minor Changes

- e9ad9fc: Adds same-file `calls` edges: a function/method that calls another function/method defined in the same file (via a bare identifier, e.g. `foo()`) now gets a `calls` edge to it in the graph. Qualified calls (`this.x()`, `self.x()`, `obj.x()`) are deliberately not resolved — without real type information there's no reliable way to tell whether the receiver refers to something in this file. Implemented for TypeScript, Python, Java, and JavaScript; Kotlin stays on its regex parser and is excluded this release.

  This is the prerequisite spec 012 deferred symbol-level dead code on — existing analyzers (`cycles`, `dead-code`, `architecture`, `trace-impact`) are unchanged and continue to operate on `imports` edges only.

  Both viewer copies now render `calls` edges with a distinct color/arrowhead from `defines` edges.

- 9b97d6f: Migrates the Java parser from line-regex to tree-sitter. The old method regex needed a `CONTROL_FLOW_WORDS` guard just to avoid matching `} else if (...)` as a method named `if` — its own comment admitted the fix wasn't exhaustive — and missed constructors entirely (`public Foo(int x)` doesn't match a "two words before the paren" pattern once `public` is consumed as a modifier). Both are now structurally impossible rather than patched around.

  Constructors are now extracted (as `method`-type nodes labeled with the class name). Methods and constructors are attributed to their class or interface (`classId -> methodId` edge) instead of flattened to the file. Real cyclomatic complexity, including a ternary (previously excluded across all three regex-scored languages, spec 014) and two node types the old regex never distinguished: enhanced-for (`for (T x : xs)`) and do-while. Real `duplicateHash`. Import resolution (`resolveJvmImport`, shared with Kotlin) is unchanged.

  Spec 032, third of the v2.3.0 tree-sitter migration batch.

- 384a549: Migrates the JavaScript parser from line-regex to tree-sitter. Two previously-undetected bugs fixed: `javascript.ts` never set a `line` number on any node (computed one internally purely to feed the old brace-matching helper, then discarded it — the only one of the four regex parsers with this gap, and untested since nothing anywhere in this codebase asserted line numbers before now), and JS classes got zero member extraction at all.

  Class methods (instance, static — all the same node type in this grammar) are now attributed to their class (`classId -> methodId` edge), matching the precedent Python (031) and Java (032) already established. Real cyclomatic complexity, now including a ternary and correctly distinguishing `for...of`/`for...in` from a C-style `for`. Real `duplicateHash`. A concise-body arrow function (`x => x + 1`) deliberately still gets no complexity/hash, same as before this migration — there's no brace-delimited body to walk.

  Spec 033, last of the three language migrations in the v2.3.0 tree-sitter batch — TypeScript stays on the compiler API throughout.

- 265c38e: Extends `NodeType` with `struct`/`enum`/`protocol`/`extension`, laying the vocabulary groundwork for Swift and Objective-C support (specs 037-038). `Graph['stats']` gains four optional counters (`structs`/`enums`/`protocols`/`extensions`), always populated on any freshly generated graph. `search_graph`'s `type_filter` accepts the new values.

  Also fixes a pre-existing gap in the 3D viewer where `interface` and `method` node types silently fell back to a generic grey color — they now have their own distinct colors, alongside the four new types.

  No behavior change for existing (non-Swift/ObjC) projects: the original 5 stats keys are unaffected, and the four new counters report `0`.

- 5397b91: Adds Objective-C support (`.m`/`.h`) via tree-sitter: classes, categories/extensions, protocols, methods, C functions, real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and `resolveObjcImport()` (quoted `#import`/`#include` by filename-suffix match, `@import` by module-name directory match).

  A type node is emitted only from `@implementation`/`@protocol` — a bare `@interface` (`.h` declaration) contributes imports only, avoiding the split-node problem a header/implementation pair would otherwise cause. `calls` edges resolve `self`/`super` message sends (a deliberate, documented divergence from the other four parsers' bare-call-only rule — Objective-C has no bare method-call syntax at all) plus bare C function calls.

  Zero changes to `graph-gen.ts` or `file-discovery.ts` — same result as the Swift parser (spec 037).

- f2de187: Migrates the Python parser from line-regex to tree-sitter. Python previously had no real import extraction at all — the loop existed but its body was dead code, so every Python project silently produced zero cross-file `imports` edges while `nodum sync` reported success. It now resolves absolute (`import os.path`, `from os import x`), package (`from pkg import x` → `pkg/__init__.py`), and relative (`from . import sibling`, `from .pkg import x`) imports into real edges via new `resolvePythonImport()`.

  Also adds real cyclomatic complexity (including ternaries — the old regex-based scorer deliberately excluded them across all three of its languages to dodge a Kotlin false-positive that doesn't apply to a tree-sitter-based parser) and `duplicateHash` for Python for the first time, fixes a class/function name collision from a shared name-tracking set, fixes `async def` never matching the old `^\s*def` regex anchor, and attributes class methods to their class (`type: 'method'`, `classId -> methodId` edge) instead of flattening them into file-level `function` nodes.

  Spec 031, second of the v2.3.0 tree-sitter migration batch.

- 7a8d6b4: Unifies Swift and Objective-C import resolution into one shared `resolveSwiftObjcImport()`, mirroring how JVM dotted-FQN imports already resolve across Java and Kotlin. A Swift `import Foo` now resolves to `Foo`'s `.m`/`.h` files and vice versa — a mixed Swift+Objective-C project renders as one connected graph instead of two disconnected islands. A quoted `#import "Foo.h"` with no `.h`/`.m` match also probes a same-basename `.swift` file, the bridging-header case.

  This is file-level `imports` edges only — not symbol-level `@objc` call resolution, which would require changes to `graph-gen.ts` and is deferred to a future spec, same posture as same-file `calls` edges deferring cross-file resolution.

  Last spec in the v2.7.0 "iOS: Swift + Objective-C" batch (036-039).

- 0d550d5: Adds first-class Swift support (`.swift`) via tree-sitter: classes, structs, enums, actors, extensions, protocols, methods, `init`/`deinit`, real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and Swift module import resolution (directory-suffix matching, mirroring how JVM dotted-FQN imports already resolve — no `Package.swift`/`.xcodeproj` parsing).

  `class`/`struct`/`enum`/`actor`/`extension` all parse as one grammar node in this tree-sitter grammar, disambiguated by keyword; `protocol` is a distinct node. Local (nested) functions are not extracted as their own nodes — a documented scope reduction, not a bug.

  Zero changes to `graph-gen.ts` or `file-discovery.ts` — the parser plugin architecture built in the tree-sitter migration batch (specs 030-035) generalizes cleanly to a language family that shares nothing with the five parsers that existed before it.

  Also switches the workspace's Vitest `pool` to `forks` — the default `threads` pool reliably crashed once enough tree-sitter grammars were JIT-compiled across a shared V8 instance; `forks` isolates each test file into its own process, fixing it.

- afa1ed2: Adds a tree-sitter runtime (`web-tree-sitter@^0.25.10` + `tree-sitter-wasms@^0.1.13`, pinned deliberately — 0.26.x breaks ABI compatibility with these grammars, tree-sitter#5171) as the foundation for migrating the regex-based parsers to tree-sitter in upcoming releases. `Parser.parse()` is now async (`Promise<ParseResult>`) — a signature change affecting anyone implementing the `Parser` interface directly, though all five existing parsers' own behavior is unchanged (verified byte-identical graph output on an unchanged fixture project).

  New `registerParser()` export lets a consumer register an additional parser at runtime instead of needing to fork `nodum-core`. `Parser` is now exported as a real class (previously type-only), so `registerParser()` is actually usable — `class MyParser extends Parser { ... }` works.

  Closes three abstraction leaks: import resolution now dispatches through an optional `Parser.resolveImport()` method instead of a hardcoded extension list in `graph-gen.ts`; ignored directories (`IGNORED_DIRS`) are now contributed by each parser (`ignoredDirs?: string[]`) merged with a smaller cross-cutting base set, and additionally overridable per-project via `.nodumrc.json`'s new `ignoredDirs` key.

  No language migration in this release — spec 030, first of the v2.3.0 batch.

### Patch Changes

- e129d4f: Consolidates duplicated `Graph`/`Node`/`Edge` type declarations. `packages/core/src/analyzer/clustering.ts`, `packages/mcp/src/embeddings.ts`, and `packages/mcp/src/smart-context.ts` now import these types from `@caiquebrito/nodum-core` instead of hand-redeclaring an approximation of them. `packages/mcp/src/handlers.ts`'s local `Graph` type (which used `type: string` instead of the real `NodeType`, papered over with an `as unknown as CoreGraph` cast at five call sites) is removed entirely along with all five casts.

  Fixes a stale doc comment claiming 1536-dim embeddings — the real model is 384-dim. Pure type consolidation with no intended behavior change; verified via a real end-to-end sync exercising every previously-cast handler.

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
