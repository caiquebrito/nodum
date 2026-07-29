# 052 — All-pairs near-duplicate grouping

## Status: done

Implemented and tested (12 `detectNearDuplicates` cases including a genuine 3-way mutual-clique
case and a real chain-vs-clique regression case; +2 `suggest_refactoring` cases; +4 CLI `--fuzzy`
cases). Full workspace suite green (537 core, 83 mcp, 101 cli, 15 server). Real end-to-end
verification caught and fixed **two** genuine bugs before this shipped — a call-stack crash on a
huge real group, and a fundamentally wrong grouping semantic that merged 7,607 unrelated real
functions into one meaningless group — both detailed below. Third and final spec in the v2.11.0
batch.

## Goal

Group near-duplicate code across a whole project — not just "similar to this one node"
(`find_similar_code`, spec 048) — the "Spec B" spec 048 explicitly deferred.

## Why now

Spec 048 deferred all-pairs grouping on two assumed blockers: LSH banding would be needed to avoid
O(n²) cost, and grouping would need a breaking `DuplicateGroup` type change. This batch's research
measured both assumptions wrong: with signatures decoded once into typed arrays (the actual perf
hazard, not the O(n²) pair count itself), a large real project's ~15,830 scored nodes full-pairwise-
compare in single-digit seconds — no LSH needed. And `DuplicateGroup` has zero consumers reading its
`.hash` field, so a new sibling type is fully additive — no breaking change needed at all.

## Scope

- New `analyzer/near-duplicate.ts`: `detectNearDuplicates(graph, options?): DetectNearDuplicatesResult`,
  where `NearDuplicateGroup = { nodes: {nodeId, label, file}[], minSimilarity, avgSimilarity }`.
  `DuplicateGroup`/`duplication.ts` untouched — confirmed zero consumers read `.hash`.
- `parser/similarity-signature.ts`: exported `decodeSimilaritySignature` (as `Uint16Array`, not
  `number[]`) and a new `estimateSimilarityFromLanes(a, b)` split out from `estimateSimilarity`, so
  a bulk caller decodes each signature once instead of per pairwise comparison.
- Reuses spec 048's `DEFAULT_SIMILARITY_THRESHOLD` (0.65) as-is — no new calibration needed.
- Output capped via `limit` (default 20, mirroring `findSimilarCode`'s pattern), sorted by group
  size then average similarity, with an explicit `truncated` flag — no silent caps.
- CLI: `nodum duplicates --fuzzy [--threshold] [--limit]`.
- MCP: a new `near-duplication` category in `suggest_refactoring`, alongside the existing
  `duplication` category — the natural integration point, since it already unifies every other
  analysis capability. Uses an unbounded `limit` there (unlike the CLI/library default) so this one
  category doesn't silently truncate the otherwise-uncapped unified feed.

## Out of scope

- Any change to `duplication.ts`/`DuplicateGroup` — confirmed unnecessary.
- New LSH banding — confirmed unnecessary at real project scale.
- A dedicated MCP tool for near-duplicate grouping — `suggest_refactoring`'s new category is this
  spec's only new MCP surface, judged sufficient over a narrower standalone tool.

## Design

### First real bug: a `Math.min(...array)` spread crashes on a huge real group

The first working implementation used `Math.min(...similarities)` to compute a group's minimum
pairwise similarity. Real end-to-end verification against `vv-viaunica-android`'s actual synced
graph (15,830 real scored nodes) crashed with `Maximum call stack size exceeded` — a huge real
group's internal pair count exceeded V8's argument-spread limit. Fixed with a manual accumulation
loop instead of spreading a potentially huge array as call arguments — a mechanical fix, but one
only a real-scale run surfaced; nothing at unit-test scale would have caught it.

### Second, more fundamental real bug: single-linkage transitive closure produces a meaningless mega-group

The originally planned semantic (this batch's own scoping) was full transitive closure via
union-find: "A~B~C groups together even if A~C alone is below threshold, as long as each is linked
to some other member" — reasoned to match how a human reads "this cluster of functions are all
near-duplicates of each other." Real end-to-end verification proved this reasoning wrong: after
fixing the crash above, the same real project produced one single group of **7,607 nodes** —
functions with no real relationship to each other (an Activity's `onCreate`, an unrelated
`ViewModel` test assertion, ...) chained together purely because each pair separately cleared a
lenient-enough threshold somewhere along a long path. Over 13% of the project's scored nodes ended
up in one meaningless "near-duplicate" group — the opposite of useful, and a direct violation of
what "these are all near-duplicates of each other" should mean to a reader.

Fixed by switching the grouping semantic from single-linkage transitive closure to a **quasi-clique
requirement**: every member of a group must clear `threshold` against *every other* member, not
merely be transitively reachable. Exact maximum-clique cover is NP-hard, so this uses a greedy
approximation instead — process candidates in a fixed (node-array) order; each unassigned node seeds
a new group, and its unassigned neighbors are added greedily (highest similarity to the seed first)
only if they clear `threshold` against *every* node already in the group, not just the seed. This is
order-dependent (a different starting order can produce a different, equally valid quasi-clique
cover) but never produces a group with an internal pair below `threshold` — the property the
original design was missing. Re-running against the same real project after this fix produced a
maximum group size of 312 (down from 7,607) — and inspecting it directly confirmed it's a genuine,
useful finding: 312 real Espresso/Robolectric `given...when...then...` test functions that really
are all structurally near-identical to each other, not an artifact of chaining.

This is a genuine example of this project's standing practice — verify against real data before
trusting a design, even one already reasoned through and written into a plan — catching a real
correctness bug that no synthetic unit test at small scale would have surfaced, since the defect
only manifests once enough real pairwise similarity edges exist to form a long chain.

## Acceptance criteria

- [x] `detectNearDuplicates` groups nodes by pairwise similarity, decoding each `similaritySignature`
      exactly once (verified via a spy-based regression test), not per pairwise comparison.
- [x] Every group is a genuine quasi-clique — every member pairwise-similar to every other member
      above `threshold` — not merely transitively connected through a chain.
- [x] Output respects `limit`, reports `truncated` accurately, sorted deterministically.
- [x] `DuplicateGroup`/`duplication.ts` fully unmodified.
- [x] `nodum duplicates --fuzzy` groups a real hand-built 3-node near-duplicate cluster correctly
      and excludes an unrelated function.
- [x] `suggest_refactoring` includes a `near-duplication` category alongside `duplication`,
      uncapped like every other category in that unified feed.
- [x] Real-scale run against a large real project (15,830 scored nodes) completes in single-digit
      seconds with no crash and no meaningless mega-group.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`near-duplicate.test.ts` (12 cases): a simple identical pair; a genuine 3-way mutual clique
(all pairs above threshold); the real chain-vs-clique regression (A~B, B~C above threshold, A~C
below — must NOT group all three, the exact shape that produced the real 7,607-node mega-group);
custom threshold respected; zero groups when nothing qualifies; nodes with no signature ignored;
`limit`/`truncated` respected; default limit; deterministic sort (size then avg similarity) and
member ordering; effective threshold reporting; a spy-based regression test confirming
`decodeSimilaritySignature` is called exactly once per node, not per pair. `suggest-refactoring.test.ts`
(+2 cases): one `near-duplication` suggestion per fuzzy group; omitted when no fuzzy groups exist;
fixed category order updated. `duplicates.test.ts` (+4 cases): `--fuzzy` grouping, `--fuzzy --json`
raw output, the "none found" message including the effective threshold, `--threshold`/`--limit`
pass-through.

**Real end-to-end (mandatory):** a hand-built 4-function TypeScript fixture (three genuinely
near-identical `validateUserInput*` variants sharing the same validation branches with a differing
log message/added field, plus one unrelated function), synced via the real CLI. `nodum duplicates
--fuzzy` correctly grouped all three near-duplicates (avg 96% similarity) and excluded the unrelated
function. Real-scale run against `vv-viaunica-android`'s actual synced graph (15,830 real scored
nodes, itself freshly re-synced by spec 051's real verification): first run crashed with a real
call-stack overflow on a huge group, fixed; second run (still using single-linkage) produced a real,
inspected, and confirmed-meaningless 7,607-node mega-group mixing unrelated functions, fixed by
switching to the quasi-clique semantic; final run completed in 5.49 seconds, largest group 312 (a
real, inspected, and confirmed-genuine cluster of near-identical Android test boilerplate), 20
groups returned with `truncated: true` correctly disclosed.

## Success Metrics

- Real check: a real call-stack crash was caught and fixed by running against a real 15,830-node
  scored graph — no synthetic test at any reasonable size would have surfaced this class of bug.
- Real check: this spec's originally planned grouping semantic (transitive closure) was proven wrong
  by the same real run — 7,607 real, inspected, unrelated functions wrongly merged into one group —
  and the fix (quasi-clique) was verified against the same real data to bring the largest group down
  to 312 genuinely-related functions.
- Real check: the final implementation completes in 5.49 seconds against 15,830 real signatures,
  with zero silent truncation (`truncated: true` correctly reported when the real project's groups
  exceeded the default limit of 20).

## Related

Third and final spec in the v2.11.0 batch (MCP protocol fix, Kotlin module labeling, near-duplicate
grouping). Builds directly on spec 048's calibrated threshold/signature format — no new calibration
needed. Independent of specs 050/051 — no shared code.
