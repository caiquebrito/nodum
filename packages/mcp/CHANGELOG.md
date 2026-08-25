# @caiquebrito/nodum-mcp

## 2.17.3

### Patch Changes

- Updated dependencies [d85dce9]
- Updated dependencies [5573921]
  - @caiquebrito/nodum-core@2.17.3
  - @caiquebrito/nodum-query@2.17.3

## 2.17.2

### Patch Changes

- Updated dependencies [61d75f4]
  - @caiquebrito/nodum-core@2.17.2

## 2.17.1

### Patch Changes

- 20004e9: `search_graph` no longer rebuilds and retokenizes a full plain-text dump of the entire graph on every call just to compute the "N% fewer tokens than a full graph dump" savings footer — that value doesn't depend on the query, so it's now computed once at sync time and persisted as `graph.stats.rawDumpApproxTokens` (`buildStats()`), with `smart-context.ts` falling back to the old on-demand computation only for a graph synced by an older nodum version that doesn't have the field yet. Measured 9.08x faster (1130ms → 124ms average per call) on an 80,000-node synthetic graph.
- bc766c3: Reduce `buildSmartContext`'s CPU and token cost. `buildContextSections` no longer independently re-scans `graph.edges` per node (an O(nodes × edges) rescan of the exact adjacency `expandContext` had already built and discarded) — both now share one `buildGraphAdjacency` map, an ~11-77x speedup on synthetic benchmarks depending on graph shape. `search_graph`'s `token_budget` now defaults to 1500 when the caller omits it, so the budgeting machinery (`fillSectionsToBudget`) runs on the common path instead of almost never; pass `0` or `null` explicitly for the old unbounded behavior. The summary/notes footer is now shown in full only on a session's first `search_graph` call (tracked via `ConversationCache`), with a short node-count-only form on subsequent calls in the same session. Decoration (emoji/box-drawing) was measured and left in place — real but modest savings (4-12%) with no way to measure downstream-LLM comprehension impact in this environment; see spec 070 for the full evidence.
- 1de5d9f: Dead-code detection no longer flags scripts that are only ever invoked as a CI/shell subprocess (e.g. a Python script called from `bitrise.yml`/GitHub Actions/a wrapper `.sh`) as unreachable. New `findCiInvokedFiles` scans `.yml`/`.yaml`/`.sh` files for script-path tokens and resolves them against the graph, the same way `findManifestEntryFiles` already does for `AndroidManifest.xml` — wired into the CLI `dead-code` command and MCP's `suggest_refactoring`.
- 41be22f: Enrich node embedding text with graph context instead of just `"<label> <type>"` (e.g. `authenticateUser function`). `generateNodeEmbedding` now embeds the identifier-split label, type, file basename, and — when present — module/layer/sourceSet, plus up to 5 outgoing call targets and up to 5 incoming callers, all built from adjacency maps constructed once per sync rather than per node. Label splitting reuses the shared `tokenizeIdentifier` utility (spec 068) instead of a second copy. Adds `Graph.embeddingVersion`; `hasEmbeddings()` now treats a missing or stale version as "not embedded" so an old graph.json's embeddings never get silently compared against a query embedded with the new text.
- 83620d2: Fix `buildSmartContext`'s hybrid keyword+semantic ranking, which combined a 0-40 keyword rank with a 0-1 cosine similarity via a weighted sum — keyword score dominated almost completely, making semantic search functionally near-disabled. Replaced with Reciprocal Rank Fusion (RRF), the standard fix for combining rankers on incomparable scales. `mergeScores` and the new `fuseByRRF` primitive live in `semantic-search.ts`; `semanticScoreNodes` also drops its now-mostly-inert `score > 0` filter in favor of a bounded top-K selection.
- e2cb861: Replace `scoreNode`'s raw substring matching with term-based, IDF-weighted matching over split identifiers (spec 068). New `tokenizeIdentifier` splits camelCase/PascalCase/snake_case/kebab-case labels into terms; a per-graph `TermIndex` (built once per `buildSmartContext` call) scores an exact split-term match higher than a coincidental substring match, and weights each term's contribution by its IDF across the graph's own vocabulary — rare, discriminative terms like `authenticate` now count for more than near-ubiquitous ones like `get`. `extractKeywords`'s length filter also drops from `word.length > 2` to `word.length > 1` (with an explicit short-word stop-list), recovering real identifier fragments like `id`, `db`, `ui`, `io` that used to be silently filtered out.
- 96bb981: Add `nodum metrics [projectPath] [--json]`, reading back `~/.nodum/<project>/logs/metrics.jsonl` (written by every MCP tool call since spec 025, previously write-only) and reporting per-tool call counts, success rate, p50/p95 duration, mean approx tokens, cache-hit rate, and truncation rate. `ToolCallMetric` gains optional `query`/`resultNodeCount`/`cacheHit`/`budgetApplied`/`truncated` fields, populated by the MCP server's `withMetrics` wrapper.
- 8cebdd1: Extract `packages/mcp/src/handlers.ts`'s graph-query logic (and the `smart-context`/`embeddings`/`semantic-search`/`conversation-cache`/`graph-cache`/`identifier-tokenize` modules it depends on) into a new internal `packages/query` workspace, so a future LSP server (spec 072+) can call the same query layer without depending on `@caiquebrito/nodum-mcp` or the MCP SDK. `packages/mcp/src/index.ts` is now a thin adapter — MCP tool registration and `withMetrics` wrapping only, calling into `@caiquebrito/nodum-query` for everything else. Pure refactor, no user-facing behavior change: the full pre-existing test suite passes with the same assertions, just relocated (plus two new smoke tests guarding against regressing query logic back into `packages/mcp`).
- Updated dependencies [20004e9]
- Updated dependencies [1de5d9f]
- Updated dependencies [41be22f]
- Updated dependencies [96bb981]
  - @caiquebrito/nodum-core@2.17.1

## 2.17.0

### Patch Changes

- fc837f6: Fixes dead-code/duplication/cycle/bottleneck false positives found in a real-world Kotlin/Android accuracy audit (~13-40% precision on that codebase before this fix):

  - **dead-code**: Kotlin same-package/no-import symbol resolution (new `referencedIdentifiers`/`declaredTopLevelNames` fields on file nodes) and AndroidManifest.xml entry-point awareness (new `android-manifest.ts`, exported as `findManifestEntryFiles`/`parseManifestEntryPoints`), wired into the CLI `dead-code` command and MCP's `suggest_refactoring` (new `SuggestRefactoringOptions.deadCodeEntryPatterns`).
  - **cycles**: a specifier resolving back to its own file no longer emits a self-import edge, fixing a Kotlin companion-object import (`import Foo.Companion.x` inside `Foo.kt` itself) being reported as a circular import.
  - **duplication**: suggestions from `suggestRefactoring` now name the actual duplicated symbol instead of a generic count; `detectDuplicates` suppresses a group when its members already delegate to a shared helper call (that's reuse, not duplication).
  - **bottlenecks**: `Bottleneck` gains a `risk: 'high' | 'foundational' | 'complex' | 'low'` classification so a low-complexity, high-fan-in shared type (e.g. a `Result` monad) isn't reported the same as a genuine complex chokepoint; surfaced in both the CLI and MCP output.

- Updated dependencies [fc837f6]
  - @caiquebrito/nodum-core@2.17.0

## 2.16.0

### Minor Changes

- 3ef9c1c: Fixes the real Node `v25.9.0` crash (`Fatal process out of memory: Zone`) that has affected very large project syncs since spec 055 (v2.12.0). Root-caused via a real native stack trace to a genuine bug in V8's Turboshaft WASM optimizing compiler when compiling a tree-sitter grammar module — confirmed by elimination against real, measured V8 flags. `--liftoff-only` (forcing baseline-only WASM compilation) avoids it entirely; since neither `NODE_OPTIONS` nor a runtime `v8.setFlagsFromString()` call can apply this flag (both verified not to work), `nodum` and `nodum-mcp` now transparently re-exec themselves with it. Real check: the exact real ~21,447-file KMP project that crashed in ~3 seconds now completes end to end with zero manual flags — 246,186 dependencies, matching every prior successful run exactly.

### Patch Changes

- Updated dependencies [3ef9c1c]
  - @caiquebrito/nodum-core@2.16.0

## 2.15.0

### Patch Changes

- Updated dependencies [deb21f3]
  - @caiquebrito/nodum-core@2.15.0

## 2.14.0

### Patch Changes

- @caiquebrito/nodum-core@2.14.0

## 2.13.0

### Minor Changes

- 157caca: Migrates the MCP server from the deprecated low-level `Server`/`setRequestHandler` API to `McpServer`/`registerTool`. All 14 tool schemas rewritten as zod raw shapes (mechanical, no behavior change); `handlers.ts` untouched. Fixed a real TypeScript compiler limitation (`moduleResolution: "node"` vs `"bundler"`) found during implementation, scoped to this package only. Invalid-args/unknown-tool calls no longer produce a metrics log entry (now handled by the SDK before any callback runs) — a disclosed, accepted gap, verified against real server behavior.

  Second of two specs in the v2.13.0 batch.

### Patch Changes

- Updated dependencies [61d00ca]
  - @caiquebrito/nodum-core@2.13.0

## 2.12.0

### Minor Changes

- b17df4c: Bumps `@modelcontextprotocol/sdk` from `^0.7.0` to `^1.30.0`, keeping the deprecated but still-supported low-level `Server`/`setRequestHandler` API this codebase uses (the `McpServer`/`registerTool` rewrite remains a separate future investigation). Adds `zod` as an explicit dependency (now a non-optional SDK peer dependency) and adds `index.ts`'s first real test coverage.

  Second of three specs in the v2.12.0 batch.

### Patch Changes

- Updated dependencies [d949b11]
  - @caiquebrito/nodum-core@2.12.0

## 2.11.0

### Minor Changes

- 97f89ab: Labels Gradle modules (`forro/feature`, `app`, ...) on `Node.module`, derived purely from file path convention — no `settings.gradle` parsing needed. `mcp get_node` shows a `Module:` line when present. Also removes the confirmed-dead `readSettingsGradle` from `config-reader.ts`.

  Second of three specs in the v2.11.0 batch.

- 980bbc7: Fixes every MCP tool-call error response to be protocol-valid: handlers previously returned a bare `{ error: string }` object, which fails the MCP SDK's own `CallToolResultSchema` validation (`content` is required, `isError` is a separate optional flag) — likely surfacing to a real MCP client as a transport/parse failure instead of the actual error message. Error responses now return `{ content: [...], isError: true }`.

  First of three specs in the v2.11.0 batch.

- 31d9c86: Adds all-pairs near-duplicate grouping across a whole project: `nodum duplicates --fuzzy` and a new `near-duplication` category in `suggest_refactoring`. Groups are quasi-cliques (every member pairwise-similar to every other member above the threshold), not transitively-chained — real-scale verification found single-linkage transitive closure merges thousands of unrelated functions into one meaningless group on a large real project.

  Third of three specs in the v2.11.0 batch.

### Patch Changes

- Updated dependencies [97f89ab]
- Updated dependencies [31d9c86]
  - @caiquebrito/nodum-core@2.11.0

## 2.10.0

### Minor Changes

- edbdbce: Fixes a real stack-detection gap: `readBuildGradle`/`readSettingsGradle` only ever read the plain `.gradle` (Groovy) filenames, never `.gradle.kts`/`settings.gradle.kts` (Kotlin DSL) — modern Kotlin/Android projects using the Kotlin DSL went completely undetected (`languages`/`frameworks`/`buildTools` all empty). Also fixes framework detection (`androidx.compose`) in multi-module projects, where plugin markers commonly live in a module's own build file, not the root's.

  New `Node.sourceSet` field, path-convention-derived (`commonMain`, `androidMain`, `test`, ...) — surfaced in MCP's `get_node` output when present.

  Fourth and final spec in the v2.10.0 batch.

- 200cc79: `find_similar_code`/`nodum similar-code` is now genuinely fuzzy — previously it only matched exact structural duplicates (byte-for-byte identical normalized token streams). It now also finds near-duplicates (the same logic with a branch added, a minor refactor) via a new MinHash-style similarity signature computed at parse time across all 8 supported languages, with no new dependency. Exact matches still take precedence and are unaffected.

  New `Node.similaritySignature` field (additive, alongside the existing `duplicateHash`). CLI gains `--threshold`/`--limit` flags; MCP's `find_similar_code` gains an optional `threshold` parameter. The default threshold (0.65) was calibrated against real code, not asserted — see spec 048's spec doc for the calibration data.

  Third of four specs in the v2.10.0 batch.

### Patch Changes

- Updated dependencies [edbdbce]
- Updated dependencies [200cc79]
  - @caiquebrito/nodum-core@2.10.0

## 2.9.0

### Patch Changes

- Updated dependencies [88c2842]
- Updated dependencies [9864c49]
- Updated dependencies [1a65311]
  - @caiquebrito/nodum-core@2.9.0

## 2.8.0

### Minor Changes

- 8985542: Adds an in-process cache for each project's parsed `graph.json`, avoiding a full disk-read + re-parse on every single MCP tool call. Some real projects' graphs are tens of MB — this previously meant re-parsing the whole file for two tool calls seconds apart in the same conversation turn.

  The cache is invalidated automatically right after `sync_project` writes a fresh graph, mirroring the existing conversation-cache invalidation. A 5-minute TTL exists as a safety net for the (uncommon) case of an external `nodum sync` run from a separate terminal while the MCP server stays open.

  First spec in the v2.8.0 "adaptive context budgeting" batch.

- 4134bf4: File discovery (`discoverFiles`/`discoverChangedFiles`) now reads/hashes files with bounded concurrency instead of sequentially — a real wall-clock win on larger projects, with byte-identical output (verified against a frozen real-project snapshot, including cluster assignment).

  Adds file-size and file-count sync guardrails, configurable via `.nodumrc.json`: `maxFileSizeBytes` (default 2 MB) excludes an oversized file individually with a warning rather than reading/parsing it; `maxFilesWarning` (default 20,000) warns once a project's file count crosses the threshold, without truncating the sync. Warnings surface through the CLI (`console.warn`) and the MCP server's `sync_project` response text.

  Also fixes a latent tree-sitter parser safety issue: `TreeSitterParser` no longer memoizes a single shared `TSParser` per instance for its whole lifetime — each parse now gets its own `TSParser` bound to the already-shared, genuinely-immutable `Language`, matching what the underlying grammar loader was already doing correctly. WASM-allocated parse trees are now freed (`tree.delete()`) once node/edge extraction completes, across all 5 tree-sitter-backed languages (Python, Java, JavaScript, Swift, Objective-C).

  Third and final spec in the v2.8.0 "adaptive context budgeting" batch.

- a16e3b2: `search_graph` accepts an optional `token_budget` parameter — context is filled greedily by relevance until the budget is spent, instead of a fixed node-count truncation. The single highest-priority section is always included even if it alone exceeds the budget.

  Also fixes `type_filter` on `search_graph`, which was previously accepted but silently ignored — it now actually restricts search candidates to the given node type, while still allowing expansion into neighbors of other types for surrounding context.

  `buildSmartContext`'s signature changed from positional `(query, graph, maxNodes, cache)` to `(query, graph, options)` with an `options: { maxNodes?, tokenBudget?, cache?, typeFilter? }` object — a breaking change for any direct caller of this exported function, though it's an internal MCP-package API, not a published CLI/core surface.

  Second spec in the v2.8.0 "adaptive context budgeting" batch.

### Patch Changes

- Updated dependencies [4134bf4]
  - @caiquebrito/nodum-core@2.8.0

## 2.7.0

### Minor Changes

- 265c38e: Extends `NodeType` with `struct`/`enum`/`protocol`/`extension`, laying the vocabulary groundwork for Swift and Objective-C support (specs 037-038). `Graph['stats']` gains four optional counters (`structs`/`enums`/`protocols`/`extensions`), always populated on any freshly generated graph. `search_graph`'s `type_filter` accepts the new values.

  Also fixes a pre-existing gap in the 3D viewer where `interface` and `method` node types silently fell back to a generic grey color — they now have their own distinct colors, alongside the four new types.

  No behavior change for existing (non-Swift/ObjC) projects: the original 5 stats keys are unaffected, and the four new counters report `0`.

### Patch Changes

- e129d4f: Consolidates duplicated `Graph`/`Node`/`Edge` type declarations. `packages/core/src/analyzer/clustering.ts`, `packages/mcp/src/embeddings.ts`, and `packages/mcp/src/smart-context.ts` now import these types from `@caiquebrito/nodum-core` instead of hand-redeclaring an approximation of them. `packages/mcp/src/handlers.ts`'s local `Graph` type (which used `type: string` instead of the real `NodeType`, papered over with an `as unknown as CoreGraph` cast at five call sites) is removed entirely along with all five casts.

  Fixes a stale doc comment claiming 1536-dim embeddings — the real model is 384-dim. Pure type consolidation with no intended behavior change; verified via a real end-to-end sync exercising every previously-cast handler.

- Updated dependencies [e9ad9fc]
- Updated dependencies [e129d4f]
- Updated dependencies [9b97d6f]
- Updated dependencies [384a549]
- Updated dependencies [265c38e]
- Updated dependencies [5397b91]
- Updated dependencies [f2de187]
- Updated dependencies [7a8d6b4]
- Updated dependencies [0d550d5]
- Updated dependencies [afa1ed2]
  - @caiquebrito/nodum-core@2.7.0

## 2.6.0

### Patch Changes

- fb2299d: Consolidates duplicated `Graph`/`Node`/`Edge` type declarations. `packages/core/src/analyzer/clustering.ts`, `packages/mcp/src/embeddings.ts`, and `packages/mcp/src/smart-context.ts` now import these types from `@caiquebrito/nodum-core` instead of hand-redeclaring an approximation of them. `packages/mcp/src/handlers.ts`'s local `Graph` type (which used `type: string` instead of the real `NodeType`, papered over with an `as unknown as CoreGraph` cast at five call sites) is removed entirely along with all five casts.

  Fixes a stale doc comment claiming 1536-dim embeddings — the real model is 384-dim. Pure type consolidation with no intended behavior change; verified via a real end-to-end sync exercising every previously-cast handler.

- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
  - @caiquebrito/nodum-core@2.6.0

## 2.5.0

### Minor Changes

- 1609350: Fixed the largest uncontrolled token risk in `search_graph`: `expandContext()` previously added _every_ 1-hop neighbor of a matched node with no cap, so a query matching a heavily-imported hub file could pull in its entire dependent list. Now capped per-seed (10 neighbors per direction) and by a hard ceiling on the total expanded set (150 nodes), built via a one-time adjacency index instead of an O(seeds × edges) rescan per seed. Measured on a deliberately hub-heavy fixture (one file with 300 dependents): 5793 → 283 `approxTokens` (spec 027, part of the v2.2.0 measurement release).

  `handleAnalyzeFile`'s file-contents list and `handleExpandCluster`'s member-node/external-deps lists were also unbounded — both now cap at 20 items with an `... and N more` suffix, matching the style already used elsewhere in these handlers.

  Also fixes `hasEmbeddings()`, found while testing: it returned vacuously `true` for a graph with zero non-file nodes (`0 >= 0`), which would incorrectly route an all-file graph through the semantic-search path instead of keyword search.

- 95fd195: New `appendMetricsLog()` in `nodum-core`, and a single instrumentation point in `nodum-mcp`'s tool dispatch (`packages/mcp/src/index.ts`) logging one JSONL line per MCP tool call to `~/.nodum/<project>/logs/metrics.jsonl` — tool name, project, duration, `approxTokens` (from spec 024), and success/failure. Makes token efficiency observable in real Claude Code sessions, not just the benchmark suite's fixture project (spec 025, part of the v2.2.0 measurement release).

  `handlers.ts`'s `NODUM_DATA_DIR` constant is now exported rather than private, so the dispatch layer can resolve the same `~/.nodum` root without a second definition.

- 4c38c43: Adds unit test coverage for the three headline v2.0 efficiency features that had none until this release: `semantic-search.ts`, `conversation-cache.ts`, and the previously-untested parts of `smart-context.ts` (`buildNodeContext` went from zero coverage anywhere in the codebase to full coverage of its truncation and not-found paths). `@caiquebrito/nodum-mcp`'s suite goes from 24 to 58 tests.

  `extractKeywords`, `scoreNode`, and `findRelevantNodes` are now exported from `smart-context.ts` (previously module-private) so they can be tested directly rather than only indirectly through `buildSmartContext()`'s output — a behavior-preserving change, but a new addition to the package's public surface (spec 029, closing out the v2.2.0 measurement release).

- 4ef9b24: `search_graph` now reports a real, computed token-savings percentage — measured against an actual full-graph-dump baseline via `estimateTokenSavings()` (unused since v2.0) and `countTokens` (spec 024) — instead of the hardcoded "40-60% fewer tokens" string. The cache-hit and semantic-search notes are now non-numeric ("served from cache", "semantic search enabled") rather than asserting unmeasured percentages ("83% more reduction", "20% better selection") that don't correspond to anything computable in the current architecture — a cache hit returns byte-identical text to a miss, so there is no separate token saving from it. `estimateTokenSavings()` also gains a zero-baseline guard to avoid `NaN%`.

  README's efficiency claims are reframed the same way: real per-response numbers and the per-session `metrics.jsonl` log (spec 025) are now the source of truth, not fixed percentages (spec 026, part of the v2.2.0 measurement release).

- 902037f: New `countTokens(text): number` exported from `nodum-core` — an approximate, offline token count (via `js-tiktoken`'s `o200k_base` encoding) for text, since Claude's real tokenizer isn't public. Named `approxTokens` everywhere it surfaces, deliberately not `tokens`, to avoid repeating the precision the codebase previously asserted without measuring (spec 024 kicks off the v2.2.0 measurement release).

  `buildSmartContext()` in `nodum-mcp` now returns `{ text, approxTokens }` instead of a bare string — pure instrumentation, MCP response bodies are unchanged. A later spec in this series (026) uses `approxTokens` to replace the hardcoded "40-60% fewer tokens" claims with real numbers.

### Patch Changes

- Updated dependencies [95fd195]
- Updated dependencies [902037f]
  - @caiquebrito/nodum-core@2.5.0

## 2.2.0

### Minor Changes

- 30af362: `nodum sync`/`nodum init` and the MCP server now check npm once a day for a newer published version and print a one-line update notice to stderr if you're behind — set `NODUM_NO_UPDATE_CHECK=1` (or `CI=true`) to disable. Also fixes both the CLI's `--version` and the MCP server's reported version, which were hardcoded to a stale `1.0.0` placeholder instead of their real published versions.

### Patch Changes

- Updated dependencies [30af362]
  - @caiquebrito/nodum-core@2.4.0

## 2.1.0

### Minor Changes

- 7d502bf: New `explain_architecture` MCP tool and companion `nodum explain-architecture [projectPath] [--json]` CLI command: auto-generates an architecture overview — which layers (groups) exist, aggregate `imports` counts between every layer pair (including self-pairs), and any violations of the project's declared architecture rules (spec 013's `detectArchitectureViolations`, reused directly). The MCP tool automatically loads a project's `.nodumrc.json` rules via the existing `projects.json` index. `explainArchitecture()` is exported from `nodum-core` for reuse.
- 98a0fe6: New `find_bottlenecks` MCP tool and companion `nodum bottlenecks [projectPath] [--json] [--limit N]` CLI command: ranks files by a composite bottleneck score combining code complexity (spec 014) with how many other files transitively depend on them (spec 016's `traceImpact`). A highly complex file nobody depends on ranks lower than a moderately complex one many files import — `score = maxComplexity × (1 + dependentCount)`. Both raw components are returned alongside the score for auditability. `findBottlenecks()` is exported from `nodum-core` for reuse; composes existing analyzers rather than adding new graph-traversal logic.
- bb1838d: New `find_similar_code` MCP tool and companion `nodum similar-code <projectPath> <nodeId> [--json]` CLI command: finds other functions/methods structurally near-identical to a given node. A thin, node-scoped lookup on top of spec 015's `detectDuplicates` (reused directly, not re-implemented) — "what's similar to this" rather than a global duplication report. `findSimilarCode()` is exported from `nodum-core` for reuse.
- 595cfe1: New `suggest_refactoring` MCP tool and companion `nodum suggest-refactoring [projectPath] [--json] [--complexity-threshold N]` CLI command: a capstone synthesis of every analysis capability shipped in this series — circular imports (011), dead files (012), architecture-rule violations (013), overly complex functions (014, default threshold 10), and duplicated code (015) — into one unified suggestion feed, grouped in a fixed category order. Zero new detection logic; pure composition of existing analyzers, reused directly. `suggestRefactoring()` is exported from `nodum-core` for reuse.

  This closes out the v2.1.0 "Advanced Graph Analysis" and "MCP Enhancements" roadmap sections (specs 010–020).

- fe1b080: New `trace_impact` MCP tool and companion `nodum trace-impact <projectPath> <nodeId> [--max-depth N] [--json]` CLI command: shows every file transitively affected by changing a given file/function/class — the cascade of changes if you modify X. Walks incoming `imports` edges via BFS, cycle-safe, resolving function/method/class nodes to their owning file first (the graph has no call/reference edges, so per-function impact within an affected file isn't determined — only which files transitively depend on it). `traceImpact()` is exported from `nodum-core` for reuse. Distinct from the existing `get_dependents` tool, which is one-hop only.

### Patch Changes

- Updated dependencies [d869063]
- Updated dependencies [b0ce5cf]
- Updated dependencies [ddbafe2]
- Updated dependencies [878f510]
- Updated dependencies [8273296]
- Updated dependencies [050e677]
- Updated dependencies [c6bcd9f]
- Updated dependencies [c288b9c]
- Updated dependencies [1a8580d]
- Updated dependencies [4fe1527]
- Updated dependencies [7d502bf]
- Updated dependencies [98a0fe6]
- Updated dependencies [bb1838d]
- Updated dependencies [595cfe1]
- Updated dependencies [fe1b080]
  - @caiquebrito/nodum-core@2.3.0

## 2.0.1

### Patch Changes

- 3395e22: Bump minimum supported Node.js version to 18 (Node 16 is end-of-life).
- Updated dependencies [3395e22]
- Updated dependencies [b32a4c0]
  - @caiquebrito/nodum-core@2.2.2
