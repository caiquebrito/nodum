# 041 — Token-budgeted smart context

## Status: done

Implemented and tested (14 new cases across `smart-context.test.ts` and `handlers.test.ts`; full
workspace suite green — 344 core, 95 cli, 77 mcp, 8 benchmarks, 524 total, up from 514 before this
spec — every pre-existing assertion passes unmodified). Real check: synced a real 25-file project
and called `handleSearch` through the actual MCP handler dispatch with a real token budget —
found and fixed a genuine overshoot bug in the process (a budget of 300 producing a 375-token
response) before landing on 287/300 and 570/600, both comfortably under budget. See Success
Metrics.

## Goal

Accept a token budget as an MCP parameter for `search_graph`, filling context greedily by
relevance until the budget is spent, instead of the previous fixed `.slice(0, N)`-count
truncation everywhere in `smart-context.ts`. Second of three specs in the v2.8.0 "adaptive
context budgeting" batch.

## Why now

`smart-context.ts` had no budget-fitting code anywhere before this spec — every limit was a node
or item count (`findRelevantNodes`'s `limit`, `MAX_NEIGHBORS_PER_SEED`/`MAX_EXPANDED_NODES`,
half a dozen per-section `.slice()` calls inside the old `formatContextText`). `countTokens()` was
already public and cheap but only ever used *after* the text was fully built, purely for
reporting. This spec makes token count something the response is actually built *toward*, not
just measured after the fact.

## Scope

- **`formatContextText` split into `buildContextSections` + a thin wrapper.** `buildContextSections`
  returns an ordered `ContextSection[]` (`{ text, nodeCount }`, one per cluster-or-file group) so a
  caller can accumulate and stop partway through; the unbudgeted path (`formatContextText`) just
  joins every section, byte-for-byte equivalent output to before this spec except for one ordering
  fix (below).
- **Section ordering fix.** The old code grouped nodes by cluster-or-file, then **re-sorted
  clusters ahead of files** after grouping — discarding the relevance-priority order that grouping
  itself already preserved (`Set` iteration in JS follows insertion order; `expandContext` inserts
  each seed immediately followed by its own neighbors, in seed-relevance order). That re-sort is
  removed — sections now render in first-encountered order, which doubles as a priority order a
  budget-limited fill can trust. No existing test asserted the old clusters-first ordering (only
  that a cluster summary appears at all), so this was safe to change.
- **`fillSectionsToBudget(sections, budget)`**: greedily includes sections in order, tracking a
  running token cost via `countTokens()` on each new section (not a full-string recount per
  iteration — cheaper, avoids O(n²) on a large expanded set). The single highest-priority section
  is always included even if it alone exceeds the budget — an empty response is a worse outcome
  than a modest overshoot on a budget that's already approximate.
- **`buildSmartContext`'s signature changed from positional `(query, graph, maxNodes, cache)` to
  `(query, graph, options)`**, where `options: SmartContextOptions = { maxNodes?, tokenBudget?,
  cache?, typeFilter? }`. Migrated cleanly rather than kept as a positional back-compat overload —
  only 5 call sites existed (1 production, 4 test), a small enough count that an options object is
  clearly the better long-term shape.
- **Fixed header/footer overhead is now reserved before the greedy section fill**, not just
  section text — this is a real bug found during this spec's own real-CLI verification step (see
  Design), not caught by unit tests before that check.
- **Fixed the dead `typeFilter` parameter.** `handleSearch` accepted a `typeFilter` argument since
  before this spec but never applied it — verified by reading the code, not assumed. Now filters
  `graph.nodes` down to matching-type candidates *before* keyword/semantic scoring, while
  `expandContext`'s neighbor lookup still uses the full unfiltered node set — so a `type_filter:
  "function"` search still shows which file each matching function lives in; the filter narrows
  what counts as a *match*, not what's allowed to appear as surrounding context. A `typeFilter`
  also bypasses the conversation cache, since cache hits are matched by keyword similarity alone
  with no awareness of `typeFilter` — reusing a cached result could silently ignore the filter.
- `packages/mcp/src/index.ts`: `search_graph`'s `inputSchema` gains an optional
  `token_budget: { type: "number" }`; dispatch passes `args.token_budget` through as a 4th
  positional argument to `handleSearch` (`handleSearch(projectName, query, typeFilter?,
  tokenBudget?)` — kept positional here, matching every other handler's existing style, rather
  than also converting `handleSearch`'s own signature to an options object).

## Out of scope

- Request-coalescing or streaming partial results as the budget fills — the whole response is
  still built synchronously in one call, just with an internal early-stop.
- Applying `tokenBudget`/`typeFilter` to any other context-returning handler
  (`handleGetNode`/`buildNodeContext`, `handleExpandCluster`, `handleAnalyzeFile`,
  `handleGetDeps`) — `search_graph` is the only tool with these new parameters this spec adds;
  extending the pattern to other tools is a natural follow-up, not bundled in here.
- Perfectly exact budget enforcement. `countTokens()` counts each concatenated piece separately
  rather than the final joined string, and BPE tokenization isn't perfectly additive across
  concatenation boundaries — so the true final count can differ by a handful of tokens from the
  sum of its parts. This is consistent with the project's existing `approxTokens` naming
  convention (spec 024) and documented directly on `fillSectionsToBudget`.

## Design

### A real overshoot bug found via real-CLI verification, not unit tests

The first working version of the budget-fill logic reserved cost **only for section text** —
the header (`"Knowledge Graph Context (...)..."`) and footer (`"📊 Summary..."`, the
percentage/notes line) were computed and appended *after* the fill decision, with no reservation
against the budget at all. This spec's own mandated real-CLI check (sync a real project, call the
actual MCP handler with a real budget) caught it immediately: a requested budget of 300 produced
an actual response of 375 tokens — a 25% overshoot, well outside what "approximate" should mean.
Every unit test written up to that point had happened not to exercise this path clearly enough to
catch it (assertions used a generous 1.5x tolerance specifically because the bug was already
baked into the numbers being asserted against). **Fixed** by computing the header text and an
upper-bound-shaped footer estimate first, reserving their combined `countTokens()` cost from the
requested budget, and only handing the *remainder* to `fillSectionsToBudget` — bringing real
output much closer to the requested number (287/300, 570/600 in the real check below). A
regression test (`"accounts for header/footer overhead, not just section text..."`) was added
alongside the fix, and the pre-existing test's tolerance was correspondingly tightened from 1.5x
to 1.15x once the real fix was in place, since 1.5x had been silently accommodating the bug.

### `expandContext`'s return type did not need to change

The original plan for this spec assumed `expandContext` would need to change from returning an
unordered `Set<string>` to an explicitly ranked array, to preserve relevance order into the
budget fill. On implementation, this turned out to be unnecessary: JavaScript `Set` objects
iterate in insertion order per spec, and `expandContext` already inserts each seed node
immediately followed by its own neighbors, in seed-relevance order. The actual blocker was
`formatContextText`'s clusters-first re-sort discarding that order *after* grouping — fixing that
(removing the re-sort) was suffient; `expandContext` itself needed no change. Documented here
since it's a real correction to the spec's own starting design, not silently dropped.

## Acceptance criteria

- [x] A `token_budget` passed to `search_graph` results in a response whose actual `approxTokens`
      is at or close to that number (within the approximation's documented tolerance), not the
      full unbounded output.
- [x] The single highest-priority section is always included, even under a budget too small for
      it alone — verified the response is never empty.
- [x] Response marks itself as truncated and reports an accurate included-vs-found count when the
      budget cuts content; does not when it doesn't.
- [x] No `tokenBudget` given behaves identically (byte-for-byte comparable structure) to the
      pre-spec-041 unbudgeted path.
- [x] `type_filter` on `search_graph` actually restricts search candidates to the given type —
      verified via a real handler-dispatch-path test, not just a `buildSmartContext`-level one.
- [x] A `type_filter` that matches nothing returns a clear "no nodes found (type: X)" message, not
      an unfiltered fallback result.
- [x] All 5 pre-existing `buildSmartContext` call sites (1 production, 4 test) migrated cleanly to
      the new options-object signature; no positional back-compat overload needed.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`smart-context.test.ts` (+13 cases across two new `describe` blocks): stays close to a tight
budget vs. the unbounded output; marks truncation and reports accurate included/found counts;
always includes the top section even under a budget of 1; the header/footer-overhead regression
case; does not truncate under a comfortable budget; unchanged behavior with no budget given;
`typeFilter` restricts candidates; `typeFilter` matching nothing returns a clear message.
`handlers.test.ts` (+2 cases): `handleSearch`'s `typeFilter` actually filters through the real
handler dispatch path (not just at the `buildSmartContext` level); `handleSearch` threads a
`tokenBudget` through without erroring even at an extreme value (1 token).

## Success Metrics

- Real check: a hand-built 25-file TypeScript project (each file a small class with one branching
  method) synced with the real CLI, then queried via the real `handleSearch` MCP handler dispatch
  path (not a unit-level call): with no budget, the response was 2452 characters; with
  `token_budget: 300`, the actual output was **375 tokens** — the overshoot bug described above,
  found here and fixed before this spec was considered done. After the fix, the same query with
  `token_budget: 300` produced **287 tokens** and `token_budget: 600` produced **570 tokens** —
  both comfortably at or under the requested budget, confirming the fix holds against real data,
  not just the unit fixtures that had been silently tolerant of the bug.

## Related

Second of three specs in the v2.8.0 "adaptive context budgeting" batch. Independent of 040 (graph
cache) and 042 (parallel discovery + parser safety fix) — no shared code with either. Builds on
spec 024's `countTokens()`/`approxTokens` convention and spec 027's `MAX_NEIGHBORS_PER_SEED`/
`MAX_EXPANDED_NODES` anti-hub pre-filter, both left unchanged and composed with, not replaced.
