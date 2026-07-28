# @caiquebrito/nodum-cli

## 2.7.0

### Patch Changes

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
  - @caiquebrito/nodum-server@2.7.0

## 2.6.0

### Patch Changes

- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
  - @caiquebrito/nodum-core@2.6.0
  - @caiquebrito/nodum-server@2.6.0

## 2.5.0

### Patch Changes

- Updated dependencies [95fd195]
- Updated dependencies [902037f]
  - @caiquebrito/nodum-core@2.5.0
  - @caiquebrito/nodum-server@2.5.0

## 2.4.0

### Minor Changes

- 30af362: `nodum sync`/`nodum init` and the MCP server now check npm once a day for a newer published version and print a one-line update notice to stderr if you're behind — set `NODUM_NO_UPDATE_CHECK=1` (or `CI=true`) to disable. Also fixes both the CLI's `--version` and the MCP server's reported version, which were hardcoded to a stale `1.0.0` placeholder instead of their real published versions.

### Patch Changes

- Updated dependencies [30af362]
  - @caiquebrito/nodum-core@2.4.0

## 2.3.0

### Minor Changes

- d869063: `nodum architecture [projectPath] [--json] [--rule <from>:<to>]` — detect `imports` edges that violate declared layer rules (e.g. `ui:repo` disallows the `ui` group importing the `repo` group), using each node's existing group classification. Deny-list only, opt-in, with `*` wildcard support. Persist rules via `nodum config --set-architecture-rules <from>:<to>,...`, stored in `.nodumrc.json` under a new `architecture.rules` key. `detectArchitectureViolations()`/`loadArchitectureConfig()`/`saveArchitectureConfig()` are exported from `nodum-core` for reuse.

  Also fixes a latent bug in `saveScanConfig`: it previously round-tripped through only its own typed fields, silently deleting any other top-level key in `.nodumrc.json` (like the new `architecture` key) on the next `--set-include`/`--set-exclude`. It now merges into the raw JSON instead.

- b0ce5cf: Real `.gitignore` support (the `ignore` package was a dependency this whole time but never wired up) and `.nodumrc.json` include/exclude patterns via a new `nodum config` command. Also fixes `.go`/`.rs`/`.rb` extensions being discovered and counted in sync stats despite having no parser — the supported-extension list is now derived from the registered parsers themselves instead of a separately-maintained hardcoded list, so this can't drift again. Excluded directories now stop the file walk from recursing into them entirely, not just filter their contents afterward.
- ddbafe2: `nodum diff <a> <b> [--json]` — compare two graph snapshots (file paths, e.g. from `nodum export --format json`, or synced project names) and report added/removed/changed nodes, added/removed edges, and stat deltas. `diffGraphs()` is exported from `nodum-core` for reuse. Deliberately excludes `clusterId` (positional, renumbered every sync) and `embedding` (MCP-only enrichment) from change detection to avoid noisy false positives.
- e1ec292: `nodum export [projectPath] --format <json|graphml|csv> [--output <path>]` — export an already-synced project's graph for use in other tools. JSON export strips the `embedding` vectors (meaningless outside nodum's own semantic search). GraphML is real, importable GraphML for tools like Gephi/yEd/Cytoscape. CSV writes a `nodes.csv`/`edges.csv` pair with proper quote/comma escaping. Errors clearly if the project hasn't been synced yet, rather than silently syncing as a side effect.
- e7cee8a: `nodum init [projectPath]` — interactive setup wizard: offers to run the initial sync and to wire up `.mcp.json` for Claude Code. When setting up `.mcp.json`, automatically resolves absolute paths for `node`/`nodum-mcp` (the same manual `which` steps documented in the README's troubleshooting section), and merges into any existing `.mcp.json` rather than overwriting it. Fails fast with a clear message in non-interactive contexts (CI, piped input) instead of hanging.
- 878f510: `nodum watch [projectPath]` — watches a project and automatically runs an incremental sync on file changes (debounced, default 500ms, configurable via `--debounce`). Reuses the same `.gitignore`/`.nodumrc.json` rules as `nodum sync`/`nodum config`. Exports `IGNORED_DIRS` from `nodum-core` so watch mode can skip watching `node_modules`, `.git`, etc. at the filesystem level.
- 8273296: `nodum duplicates [projectPath] [--json]` — finds functions/methods that are structurally near-identical (same control-flow shape, robust to variable renaming and literal-value changes), computed at parse time as a new optional `Node.duplicateHash` field. TypeScript is normalized precisely via its real AST; JavaScript/Kotlin/Java use a new shared regex-based tokenizer built on spec 014's brace-body extraction. A 20-token minimum avoids flooding output with trivial one-liner "duplicates." `detectDuplicates()` is exported from `nodum-core` for reuse. Scoped to Type-2-style exact-structural matching within a single language — Type-3 (near-matches with inserted/deleted statements) and cross-language matching are both out of scope.
- 050e677: `nodum complexity [projectPath] [--json] [--threshold N]` — ranks functions/methods by cyclomatic complexity (McCabe), computed at parse time and stored as a new optional `Node.complexity` field. TypeScript is computed precisely from its real AST; JavaScript/Kotlin/Java use a new shared brace-matching body-extraction helper plus regex-based decision-point counting (deliberately excluding ternary for these three languages — a false-positive risk in Kotlin's nullable-type syntax). Python and cognitive complexity are both out of scope for now. `rankByComplexity()` is exported from `nodum-core` for reuse.

  Also fixes a real pre-existing bug in the Java parser's method-detection regex, caught while verifying this spec against real code: `} else if (...)` was mis-parsed as a method declaration named `if`.

- c6bcd9f: `nodum dead-code [projectPath] [--json] [--entry <patterns>]` — find files no other tracked file imports, as candidates for dead-code review (not a definitive verdict — a real entry point wired up outside the parsed import graph looks identical to an orphan). Excludes test-group files and files matching a built-in entry-point-name heuristic (`index.*`, `main.*`, `*.config.*`, etc.), extensible via `--entry` for framework-specific routing conventions. `detectUnreachableFiles()` is exported from `nodum-core` for reuse. Scoped to file-level reachability only — the graph has no call/reference edges yet, so symbol-level (unused function/class) detection isn't feasible today.
- c288b9c: `nodum cycles [projectPath] [--json]` — detect circular imports in a synced project. Uses Tarjan's SCC algorithm over `imports`-relation edges to find strongly-connected components of file nodes, reporting one representative cycle chain per component (not every elementary cycle, which is combinatorially expensive on tangled real codebases). `detectCycles()` is exported from `nodum-core` for reuse.
- 4fe1527: `nodum sync --incremental` now actually skips re-reading and re-parsing files that haven't changed since the last sync, using the `graph/files.json` manifest — `discoverChangedFiles()` stat-checks every file first and only reads/hashes ones that look different, and `generateGraph()` evicts and re-parses only the changed set instead of doing a full rescan. Falls back silently to a full sync if there's no previous sync to diff against. Non-incremental `nodum sync` is unchanged.
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

## 2.2.1

### Patch Changes

- 3395e22: Bump minimum supported Node.js version to 18 (Node 16 is end-of-life).
- Updated dependencies [3395e22]
- Updated dependencies [b32a4c0]
  - @caiquebrito/nodum-core@2.2.2
  - @caiquebrito/nodum-server@2.0.3
