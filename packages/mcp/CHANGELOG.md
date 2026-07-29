# @caiquebrito/nodum-mcp

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
