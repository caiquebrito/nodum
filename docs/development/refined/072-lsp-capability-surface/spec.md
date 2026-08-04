# 072 — LSP capability surface

## Status: refined — not started

Fully designed, not yet branched. Depends on spec 071 (the transport-neutral query layer this
maps onto LSP requests).

## Goal

Stand up a real `nodum-lsp` binary mapping nodum's graph queries onto standard Language Server
Protocol requests, so every LSP-speaking IDE (Android Studio, JetBrains family, Visual Studio,
VS Code, Neovim, Zed, ...) gets them without any per-IDE code.

## Why now

This is the concrete deliverable of the LSP-core strategy (`docs/development/ROADMAP.md` v3.0.0
section): reach IDEs that have no MCP client today. Diagnostics in particular are a capability
nodum's analyzers already compute (cycles, dead code, architecture violations) but currently
require an explicit CLI invocation to see — over LSP, they become inline squiggles in every
connected editor automatically, for free, once this spec lands.

## Scope

- New workspace `packages/lsp`, added to root `package.json`'s `workspaces` array, built after
  `core`/`query` in the existing sequential build chain (`build:core && ... && build:lsp`).
  Dependencies: `vscode-languageserver` + `vscode-languageserver-textdocument` (the standard,
  editor-agnostic LSP server implementation libraries — despite the package name prefix, they
  implement the protocol, not anything VS-Code-specific). Bin: `nodum-lsp` →
  `packages/lsp/dist/index.js`.
- `packages/lsp/src/index.ts`: must call `ensureLiftoffOnly()` (`@caiquebrito/nodum-core`) first,
  exactly as `packages/cli/src/bin/nodum.ts` and `packages/mcp/src/index.ts` already do (spec
  060's Node/V8 WASM crash workaround — applies to any process using the tree-sitter-backed
  parsing/analysis stack, which this one does via the query layer).
- Map queries onto LSP requests:

  | LSP request | nodum behavior | Backing query-layer call (spec 071) |
  |---|---|---|
  | `workspace/symbol` | graph-wide semantic search | `handleSearch`-equivalent |
  | `textDocument/hover` | node summary, complexity, fan-in/fan-out | `buildNodeContext`-equivalent |
  | `textDocument/codeLens` | "N dependents · complexity X · trace impact" above each function | `traceImpact` + node lookup |
  | `textDocument/references` | graph `calls`/`imports` edges, cross-file | `handleGetDeps`-equivalent, reversed |
  | `textDocument/documentSymbol` | file's nodes from the graph | filter graph nodes by `file` |
  | `workspace/executeCommand` | `nodum.sync`, `nodum.traceImpact`, `nodum.findSimilar`, `nodum.deadCode` | direct query-layer calls |
  | `textDocument/publishDiagnostics` | cycles, dead code, architecture violations as warnings | `detectCycles`, `detectUnreachableFiles`, `detectArchitectureViolations` (`@caiquebrito/nodum-core`) |

- Server lifecycle: `initialize` triggers (or requires an already-synced project — decide during
  implementation whether the LSP server auto-syncs on first open or requires `nodum sync` to have
  already run; auto-sync is friendlier but changes startup latency expectations, so this is a
  real design decision to make with eyes open, not default blindly to "just do it automatically").
  `didSave`/`didChangeWatchedFiles` should trigger an incremental sync (reusing
  `syncProject(..., { incremental: true })`, already exported from `@caiquebrito/nodum-core`) so
  diagnostics/hover stay current without a manual `nodum sync`.

## Out of scope

- Per-IDE packaging (VSIX, JetBrains plugin, ...) — that's spec 073.
- Xcode — no general LSP client exists for it; covered separately (spec 074, expected to stay
  deferred).
- Write operations (code actions, refactoring, formatting) — nodum is a read-only knowledge
  layer; this spec only implements read/query-shaped LSP capabilities. `workspace/executeCommand`
  is the one write-adjacent surface (triggering sync/analysis), not editing code.

## Design

The `textDocument/publishDiagnostics` mapping is the highest-value, least-precedented piece:
nodum's analyzers (`detectCycles`, `detectUnreachableFiles`, `detectArchitectureViolations`, all
already exported from `@caiquebrito/nodum-core`) return structured results with file/line
information already; converting those to LSP `Diagnostic` objects (`{ range, severity, message,
source: 'nodum' }`) is a formatting layer, not new analysis. Severity: `Warning` for all three by
default (none of them represent a compile error) — configurable later if real usage shows a need.

## Acceptance criteria

- [ ] `nodum-lsp` starts over stdio and responds to `initialize`.
- [ ] `workspace/symbol`, `textDocument/hover`, `textDocument/documentSymbol` return real data
      from a synced project's graph.
- [ ] `textDocument/publishDiagnostics` surfaces at least cycles and dead-code findings as LSP
      diagnostics.
- [ ] `didSave`/`didChangeWatchedFiles` triggers an incremental re-sync and diagnostics refresh.
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

Unit tests per LSP-request handler (mock `TextDocuments`/connection, real query-layer calls
against a small fixture graph — same fixtures `benchmarks/projects/` already provides). One
integration-style test spinning up the real server over an in-memory stdio pair and exercising
`initialize` → `workspace/symbol` → shutdown, verifying the protocol handshake itself works, not
just the individual handlers in isolation.

## Success Metrics

Manual verification against at least one real LSP client (VS Code with a minimal client
extension, or `vscode-languageserver`'s own test harness) — hover, code lens, workspace symbol,
and diagnostics all show real, correct data for a synced project.

## Related

Depends on: spec 071 (query layer), spec 060 (the `ensureLiftoffOnly` requirement this inherits).
Blocks: spec 073 (per-IDE shims wrap this server).
