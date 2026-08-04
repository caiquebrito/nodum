# 071 — Extract a transport-neutral query layer

## Status: refined — not started

Fully designed, not yet branched. First spec in the IDE-reach arc (071-074) — see
`docs/development/ROADMAP.md`'s v3.0.0 section for the strategic framing (LSP core + thin
per-IDE shims, reaching Android Studio/Visual Studio/JetBrains, which have no MCP client today).

## Goal

Lift the graph-query logic in `packages/mcp/src/handlers.ts` into a form both the existing MCP
server and a new LSP server (spec 072) can call, without either depending on the other.

## Why now

`packages/mcp/src/handlers.ts` (`handleSync`, `handleStatus`, `handleGetGraph`, `handleSearch`,
`handleGetDeps`, `handleAnalyzeFile`, `handleExpandCluster`, `handleTraceImpact`,
`handleFindBottlenecks`, `handleExplainArchitecture`, `handleFindSimilarCode`,
`handleSuggestRefactoring`) is already close to transport-neutral in substance: each function
takes plain arguments and returns formatted text, with no MCP-protocol types in its own
signatures (the MCP-specific wrapping — `ToolResult`, `isError`, `withMetrics` — lives in
`packages/mcp/src/index.ts`, one layer up). But it physically lives inside `packages/mcp`, so an
LSP server package would either have to depend on `@caiquebrito/nodum-mcp` (pulling in the MCP
SDK as a transitive dependency it doesn't need) or duplicate the query logic.

## Scope

- Move `handlers.ts`'s query functions (everything except anything that constructs an MCP
  `ToolResult` directly, if any does — audit during implementation) into `packages/core` (a new
  `src/query/` subdirectory, e.g. `packages/core/src/query/handlers.ts`) or a new standalone
  workspace package (e.g. `packages/query`) if `packages/core` would end up depending on things
  (like `packages/mcp`'s `smart-context.ts`, `embeddings.ts`, `semantic-search.ts`) that
  `packages/core` currently doesn't and shouldn't. **Decide during implementation** based on
  which produces a cleaner dependency graph — the smart-context/embeddings/semantic-search trio
  currently lives in `packages/mcp` specifically because it depends on `@xenova/transformers`
  (a heavy, MCP-server-specific dependency); moving it wholesale into `packages/core` would make
  every CLI/server consumer of `core` pull that in too. A new `packages/query` package (depending
  on `core`, and re-exporting/wrapping the smart-context machinery) is likely the cleaner shape —
  confirm before large-scale file moves.
- `packages/mcp/src/index.ts` becomes a thin adapter: MCP tool registration + `withMetrics`
  wrapping + calling into the extracted query layer, with zero query logic of its own.
- `packages/mcp/src/handlers.ts` either becomes a re-export shim (temporary, for a smooth
  transition) or is deleted with all call sites updated directly — prefer direct update
  (`handlers.ts`'s own tests move with the code) unless a re-export shim demonstrably reduces
  diff risk.

## Out of scope

- Writing the LSP server itself (spec 072).
- Changing any query function's behavior — this is a pure extraction/move, verified by the
  existing MCP test suite passing unchanged (byte-identical behavior through the new layer).

## Design

Dependency direction after this spec: `packages/mcp` depends on the new query layer;
`packages/lsp` (spec 072+) depends on the same query layer; neither `mcp` nor `lsp` depends on
the other. The query layer depends on `packages/core` (graph types, analyzers) and, if kept
together, the embeddings/semantic-search stack (`@xenova/transformers`) — the LSP package
inherits that dependency either way, same as MCP does today; it's not a new cost, just relocated.

## Acceptance criteria

- [ ] Every function currently in `packages/mcp/src/handlers.ts` is callable from a location
      that does not require depending on the MCP SDK.
- [ ] `packages/mcp`'s full existing test suite (`handlers.test.ts`, `index.test.ts`, and every
      test that exercises a handler indirectly) passes unchanged after the extraction —
      behavior-preserving move, not a rewrite.
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

No new test *behavior* — the existing `handlers.test.ts` suite (20 tests as of spec 065) moves
with the code (or stays, importing from the new location) and must pass identically. Add one
new smoke test confirming `packages/mcp` no longer has any direct handler *implementation*, only
imports (a simple grep-based or import-based check, to guard against regression back into the
old shape).

## Success Metrics

`npm test --workspaces` green with the exact same test count as before extraction (no tests
lost or silently skipped in the move).

## Related

Blocks: spec 072 (LSP capability surface — needs this layer to call into). Depends on: nothing
new — pure refactor of existing, already-tested code.
