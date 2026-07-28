# @caiquebrito/nodum-mcp

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
