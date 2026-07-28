# 035 — Consolidate the Graph type

## Status: done

Implemented and verified. `npm run build` is clean (no `as unknown as` casts anywhere in
`packages/mcp/src`) and the full workspace suite is green (271 core, 95 cli, 58 mcp, 8
benchmarks, 432 total — unchanged from spec 034, since this spec's intended runtime effect is
zero). Real check: synced a real TypeScript fixture and exercised all five MCP handlers that
previously carried the cast (`handleTraceImpact`, `handleFindBottlenecks`,
`handleExplainArchitecture`, `handleFindSimilarCode`, `handleSuggestRefactoring`) directly against
the resulting `graph.json` — all five ran correctly, unchanged in behavior.

## Goal

`Graph`/`Node`/`Edge` were hand-redeclared in five places across the codebase and had already
drifted from `core/src/types.ts`'s definitions — most visibly, `packages/mcp/src/handlers.ts`'s
local `Graph` used `type: string` instead of the real `NodeType`, papered over with an `as unknown
as CoreGraph` cast at five call sites. Import the real types from `@caiquebrito/nodum-core`
everywhere instead of re-declaring an approximation of them.

## Why now

Last spec in the v2.3.0 batch. `types.ts`'s `RelationType` and `Node`/`Edge` shapes changed twice
already this batch (031's `duplicateHash`, 034's `'calls'` relation) — every hand-rolled copy is
another place that silently drifts out of sync with what parsers actually emit, exactly as
`handlers.ts`'s copy already had.

## Scope

- `packages/core/src/analyzer/clustering.ts`: deleted its local `Node`/`Edge` interfaces, imports
  `Node`/`Edge` from `../types.js` instead. (This creates a type-only import cycle with
  `types.ts`, which already imports `NodeCluster` from `clustering.ts` — safe, since type-only
  imports are fully erased at compile time and produce no runtime cycle. Verified by a clean
  `tsc` build.)
- `packages/mcp/src/embeddings.ts`: deleted its local `Node` interface, imports `Node` from
  `@caiquebrito/nodum-core` instead.
- `packages/mcp/src/smart-context.ts`: deleted its local `Graph` interface (which had `stats:
  any`), imports `Graph` from `@caiquebrito/nodum-core` instead. `scoreNode`/`findRelevantNodes`
  already typed their parameters as `Graph["nodes"][0]`/`Graph["nodes"]`, so those signatures
  needed no further changes once `Graph` itself pointed at the real type.
- `packages/mcp/src/handlers.ts`: deleted its local `Graph` interface, renamed the `Graph as
  CoreGraph` import alias back to plain `Graph`, and removed all five `as unknown as CoreGraph`
  casts (`handleTraceImpact`, `handleFindBottlenecks`, `handleExplainArchitecture`,
  `handleFindSimilarCode`, `handleSuggestRefactoring`) along with their rationale comments — the
  cast is no longer needed once `loadGraph()`'s return type is the real `Graph`.
- Fixed the stale comment on `Node.embedding` in `types.ts` claiming 1536 dimensions — the actual
  model (`Xenova/all-MiniLM-L6-v2`, per `embeddings.ts`) is 384-dim.
- **Verified the zero-runtime-change claim rather than asserting it.** Swapping `type: string` for
  `type: NodeType` (and `group?: string` for the required `group: string`, etc.) narrowed several
  types and did surface real compile errors, exactly as anticipated:
  - `embeddings.test.ts` (4 sites) and `smart-context.test.ts` (7 sites): plain-object test
    fixtures whose `type` field inferred as `string` rather than the literal `NodeType` union, plus
    two `smart-context.test.ts` fixtures missing the now-required `group` field. Fixed by adding
    explicit `Node`/`Node[]` type annotations (or the missing `group` value) to each fixture — a
    real, if narrow, finding: these fixtures were silently accepting node shapes the real parsers
    never produce.
  - No other consumer site broke. Every production call site's `graph.nodes`/`.edges` data always
    came from a real `writeGraphFile()`-written `graph.json` in the first place, so the narrower
    types only tightened what was already true at runtime.

## Out of scope

- `packages/core/src/graph-diff.ts`'s `NodeChange`/`GraphDiff` types — unrelated, diff-specific
  shapes, not a duplicate of `Graph`/`Node`/`Edge`.
- Any behavior change to clustering, embeddings, smart-context ranking, or any MCP handler's
  output — this spec is type consolidation only.

## Design

No new abstractions — this is subtraction: delete five duplicated interface declarations, replace
with an import from the one already-correct source (`core/src/types.ts`), fix the fallout.

## Acceptance criteria

- [x] `clustering.ts`, `embeddings.ts`, `smart-context.ts`, `handlers.ts` all import
      `Node`/`Edge`/`Graph` from `@caiquebrito/nodum-core` (or `../types.js` for `clustering.ts`,
      which lives inside `core` itself) instead of redeclaring them.
- [x] Zero `as unknown as` casts remain in `packages/mcp/src`.
- [x] `Node.embedding`'s doc comment correctly says 384-dim.
- [x] `npm run build` clean across all four publishable packages.
- [x] `npm test --workspaces` green, same 432-test count as after spec 034 (no behavior change).
- [x] Real check: all five previously-cast MCP handlers run correctly against a real synced
      project's `graph.json`.

## Test plan

No new test cases — this is a type-only consolidation with no intended behavior change. Existing
`embeddings.test.ts` and `smart-context.test.ts` fixtures were adjusted (added `group` fields,
explicit `Node`/`Node[]` annotations) to satisfy the now-real, narrower types; their assertions
are unchanged. Real end-to-end check covers what a unit test can't: that `loadGraph()`'s actual
runtime shape (from a real `writeGraphFile()`-written `graph.json`) satisfies the real `Graph`
type without any cast, for every handler that used to need one.

## Success Metrics

- Real check: a two-function-plus-a-class TypeScript fixture (`main` calling `helper`, a
  `Service` class with `run()` calling `this.compute()`) synced with the real CLI, then all five
  previously-cast handlers invoked directly against the resulting project. Every one returned
  correct, sensible output (`handleFindBottlenecks` scored `app.ts` correctly; `handleExplainArchitecture`
  reported the file's layer; the other three each behaved as expected for a project this small
  with no cross-file structure to report) — confirming `loadGraph()`'s real return value needed no
  cast to satisfy the real `Graph` type.

## Related

Independent of 034 (no shared code). Last spec in the v2.3.0 tree-sitter batch (030–035). Closes
out the batch — next is the `develop → main` release PR for v2.6.0.
