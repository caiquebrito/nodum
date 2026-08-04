# 071 — Extract a transport-neutral query layer

## Status: done

Implemented as designed, choosing the new-package option the spec's Scope section flagged as
likely cleaner. All twelve `handle*` functions plus `NODUM_DATA_DIR`, and the modules they
transitively depend on (`smart-context.ts`, `embeddings.ts`, `semantic-search.ts`,
`conversation-cache.ts`, `graph-cache.ts`, `identifier-tokenize.ts`), moved unchanged from
`packages/mcp/src/` into a new `packages/query/src/` workspace, `@caiquebrito/nodum-query`
(private, unpublished — not in `.changeset/config.json`'s `fixed` group). `packages/core`'s
`package.json` was checked before deciding: it depends only on `ignore`, `js-tiktoken`,
`tree-sitter-wasms`, and `web-tree-sitter` — no `@xenova/transformers` — confirming that folding
the smart-context/embeddings/semantic-search trio into `core` would have made every CLI/server
consumer of `core` inherit that heavy embedding-model runtime. `packages/query` instead depends
on `core` and `@xenova/transformers` itself, so only `mcp` (today) and a future `lsp` package
inherit it. One real design decision beyond what the spec anticipated: `handlers.ts` did in fact
carry a type-level (not just structural) MCP SDK dependency — it imported `TextContent` from
`@modelcontextprotocol/sdk/types.js` purely for typing its return shape. Moving that import as-is
would have left the query layer needing the MCP SDK as a type-only runtime dependency, defeating
the point of the extraction. Fixed by defining a local `TextContent` interface in
`packages/query/src/handlers.ts`, structurally identical to the SDK's (`{ type: "text"; text:
string }`) — `packages/mcp/src/index.ts` still treats it as a `CallToolResult`'s content entry via
TypeScript's structural typing, so the wire format and every existing assertion (including
`handlers.test.ts`'s `CallToolResultSchema.parse` check) are byte-identical; the SDK now appears
only as a `packages/query` *devDependency*, for that one test's schema-validation import, never at
runtime. `packages/mcp/src/handlers.ts` was deleted outright (direct-update path, as the spec
preferred) rather than left as a re-export shim; `packages/mcp/src/index.ts` now imports
`handleSync`, `handleGetGraph`, etc. straight from `@caiquebrito/nodum-query`, and its
`package.json` swapped `@xenova/transformers` for `@caiquebrito/nodum-query` (still directly
depending on `@caiquebrito/nodum-core` for `checkLatestVersion`/`appendMetricsLog`/etc., unrelated
to the query layer). `benchmarks/`'s three files that deep-imported internals via
`@caiquebrito/nodum-mcp/dist/{smart-context,semantic-search,embeddings}.js` (bypassing the public
export, which is how `packages/mcp`'s lack of an `exports` field allowed it) were repointed to the
equivalent `@caiquebrito/nodum-query/dist/...` paths; `packages/query/package.json` deliberately
omits an `exports` field (matching `packages/mcp`'s existing shape) so those deep imports keep
resolving. Verified: `npm run build && npm test --workspaces` green — 604 core, 127 query
(includes the moved 20-test `handlers.test.ts` unchanged), 119 cli, 15 server, 18 mcp (the
original 16 `index.test.ts` plus 2 new smoke tests), 39 benchmarks = 922 total, vs. 920 before
this spec (the 2 new smoke tests are the only count change — see Test plan). `npx eslint packages
--ext .ts` reports the identical 486 problems (245 errors, 241 warnings) before and after,
confirming the move introduced zero new lint findings in the files it touched.

First spec in the IDE-reach arc (071-074) — see `docs/development/ROADMAP.md`'s v3.0.0 section for
the strategic framing (LSP core + thin per-IDE shims, reaching Android Studio/Visual
Studio/JetBrains, which have no MCP client today).

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

- [x] Every function currently in `packages/mcp/src/handlers.ts` is callable from a location
      that does not require depending on the MCP SDK. (`packages/query/src/handlers.ts` — zero
      runtime import of `@modelcontextprotocol/sdk`; the one remaining import is a
      `devDependency`-only, test-file-only schema-validation check.)
- [x] `packages/mcp`'s full existing test suite (`handlers.test.ts`, `index.test.ts`, and every
      test that exercises a handler indirectly) passes unchanged after the extraction —
      behavior-preserving move, not a rewrite. (`handlers.test.ts` and the rest moved to
      `packages/query` and pass with the exact same 20/44/10/19/15/7/12 per-file counts;
      `index.test.ts` passes unchanged after its one mock-path update.)
- [x] `npm run build && npm test --workspaces` green.

## Test plan

No new test *behavior* — the existing `handlers.test.ts` suite (20 tests as of spec 065) moved
with the code, importing from its new location, and passes identically. Two new smoke tests were
added (`packages/mcp/src/no-query-logic.test.ts`) confirming `packages/mcp` no longer has any
direct handler *implementation* file, and that `index.ts` imports the query layer from
`@caiquebrito/nodum-query` rather than a local module — an import-based check, guarding against
regression back into the old shape.

## Success Metrics

`npm test --workspaces` green with the same test count as before extraction plus exactly the two
new smoke tests this spec's Test plan called for: 920 tests before (604 core, 119 cli, 15 server,
143 mcp [handlers/smart-context/embeddings/semantic-search/conversation-cache/graph-cache/
identifier-tokenize/index], 39 benchmarks) -> 922 after (604 core, 127 query, 119 cli, 15 server,
18 mcp, 39 benchmarks). No tests lost or silently skipped in the move. `npx eslint packages --ext
.ts` also confirmed at an identical 486 problems (245 errors, 241 warnings) before and after.

## Related

Blocks: spec 072 (LSP capability surface — needs this layer to call into). Depends on: nothing
new — pure refactor of existing, already-tested code.
