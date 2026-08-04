# 069 — Stop paying for the raw-dump savings number on every search

## Status: refined — not started

Fully designed, not yet branched.

## Goal

Stop `buildSmartContext` from materializing and tokenizing a full string dump of the entire
graph on every single `search_graph` call, just to print a savings percentage.

## Why now

`packages/mcp/src/smart-context.ts:521-522`:

```ts
const rawDumpTokens = countTokens(buildRawGraphDump(graph));
const { percentage } = estimateTokenSavings(rawDumpTokens, countTokens(responseBody));
```

`buildRawGraphDump` (`smart-context.ts:326-334`) builds one line per node and one line per edge
— for a large synced project (the architecture research found real graphs reaching tens of MB),
this allocates a full string proportional to graph size and runs it through `countTokens`
(`packages/core/src/token-count.ts`, `js-tiktoken`) — **on every query**, even though the value
being computed (tokens in a full unfiltered dump of the graph) doesn't depend on the query at
all. It's a property of the graph, recomputed from scratch every time regardless.

## Scope

- Cache the raw-dump token count keyed to the same cache generation `globalGraphCache`
  (`packages/mcp/src/graph-cache.ts`) already uses, invalidated by `handleSync` exactly the way
  the graph cache itself already is — no new invalidation mechanism needed, piggyback on the
  existing one.
- **Better**: the raw dump's token count is close to a linear function of `graph.stats.files +
  graph.stats.functions + ...` (one line per node/edge, roughly constant tokens per line).
  Compute it once at sync time (`packages/core/src/sync.ts`, alongside where `graph.stats` is
  already built) and persist it as `graph.stats.rawDumpApproxTokens`, eliminating the per-query
  computation entirely rather than just caching it in-process. Fall back to on-demand computation
  (the current behavior) for a graph loaded from an older nodum version that doesn't have this
  field yet — same "tolerate missing optional fields from an older version" posture spec 065
  already established for `ToolCallMetric`.

## Out of scope

- Removing the savings-percentage feature itself — it's a real, useful (and, per spec 026,
  honestly-measured) number; this spec only changes how cheaply it's computed, not whether it's
  shown.
- Any change to what counts as "the graph" for this purpose (still the full node+edge dump,
  unfiltered) — that's `buildRawGraphDump`'s existing, deliberate definition (see its own doc
  comment: "represents the cost of NOT doing any of that").

## Design

Preferred approach is the persisted-at-sync-time one: add `rawDumpApproxTokens?: number` to
`GraphStats` (`packages/core/src/types.ts`), compute it in `packages/core/src/graph-gen.ts`'s
`buildStats()` (or immediately after, wherever `sync.ts` finalizes the graph before writing
`graph.json`), using the same `buildRawGraphDump`-equivalent logic (may need to move/export a
version of that function from `packages/mcp` to `packages/core` so both sides can use it without
a cross-package dependency in the wrong direction — `core` shouldn't depend on `mcp`). Then
`smart-context.ts`'s `estimateTokenSavings` call reads `graph.stats.rawDumpApproxTokens` if
present, falling back to computing it fresh (today's behavior) if absent.

## Acceptance criteria

- [ ] `search_graph` no longer rebuilds and retokenizes a full graph dump on every call when
      `graph.stats.rawDumpApproxTokens` is present.
- [ ] A graph without the field (old format) still works, falling back to on-demand computation.
- [ ] `graph.stats.rawDumpApproxTokens` is computed once at sync time and matches (or is
      reasonably close to — same tokenizer, so should match exactly) what the old per-query
      computation produced for the same graph.
- [ ] Measured: time `handleSearch`/`search_graph` before and after on a large graph (this repo's
      own, or a larger external fixture) — record the real before/after in Success Metrics.
- [ ] `npm run build && npm test --workspaces` green; `benchmarks/context-size.test.ts` ceilings
      still hold (this spec shouldn't change response *content*, only computation cost).

## Test plan

`sync.test.ts` / `graph-gen.test.ts` — `rawDumpApproxTokens` is populated on a synced graph and
roughly matches a direct `countTokens(buildRawGraphDump(graph))` call on the same graph.
`smart-context.test.ts` — `estimateTokenSavings`'s caller uses the persisted field when present,
falls back to computing it when absent (test both a graph with and without the field).

## Success Metrics

Fill in after implementation: wall-clock time for `search_graph`/`handleSearch` on a large synced
graph, before vs. after — this is a performance spec, so the real check is a timing measurement,
not an accuracy metric.

## Related

Independent of specs 066-068 (this is a cost fix, not a ranking-quality fix) — can land in either
order relative to them. Related to spec 070 (also token-cost-focused); consider landing together
if the caching infrastructure ends up shared.
