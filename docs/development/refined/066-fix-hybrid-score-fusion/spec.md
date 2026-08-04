# 066 — Fix hybrid score fusion (RRF)

## Status: refined — not started

Fully designed, not yet branched. Ready to execute: create `feature/066-fix-hybrid-score-fusion`
from `develop`, move this file to `docs/development/active/066-fix-hybrid-score-fusion/spec.md`
at the start of work, then to `docs/development/completed/` in the commit that finishes it.

## Goal

Fix `mergeScores`' scale mismatch so `buildSmartContext`'s hybrid keyword+semantic ranking
actually works as documented, and prove it with the spec 063 retrieval harness.

## Why now

`packages/mcp/src/smart-context.ts:426-437` feeds `mergeScores` two incompatible scales:

- `keywordScore` is a **rank** value: `40 - idx`, range **0–40**
  (`smart-context.ts:428-430`, from `findRelevantNodes(keywords, candidateNodes, 40)`).
- `semanticScore` is **cosine similarity**, range **0–1**
  (`semantic-search.ts:47-66`'s `semanticScoreNodes`).

`mergeScores(merged, 0.4, 0.6)` (`semantic-search.ts:72-83`) computes
`0.4 * keywordScore + 0.6 * semanticScore`. Keyword contributes up to **16.0**; semantic
contributes at most **0.6**. One keyword rank position (`0.4` per step) outweighs the entire
semantic signal. A node with *zero* keyword match caps at `0.6` — it loses to a node at keyword
rank 40 (`0.4`), which is absurd: rank 40 is nearly irrelevant by keyword matching too. The
documented "60/40 semantic/keyword hybrid" (`docs/architecture/SMART-CONTEXT.md`) does not
describe what the code does — semantic search is functionally near-disabled.

Spec 063's harness already proved the consequence: query `py-10` ("shared utilities used by
every module in the app", zero lexical overlap with its targets) scores `recall@10 = 0.00` under
the keyword-only path. This spec is what should close that gap — assuming semantic search
actually contributes once fixed.

## Scope

- Replace the scale-mismatched weighted sum with **Reciprocal Rank Fusion (RRF)** — the standard
  fix for combining rankers whose scores live on different, non-comparable scales, and it needs
  no scale normalization tuning:

  ```
  rrfScore(node) = Σ_rankers  weight_r / (k + rank_r(node))     // k = 60, conventional
  ```

  Each ranker (keyword, semantic) independently ranks all candidate nodes; a node's score is the
  weighted sum of `1 / (k + rank)` across whichever rankers ranked it at all. `k = 60` is the
  standard RRF constant (dampens the impact of rank-1 dominance; well-studied default, no
  per-corpus tuning needed to start).
- In `packages/mcp/src/semantic-search.ts`: add `fuseByRRF(rankedLists: { nodeId: string;
  weight: number }[][])` or reimplement `mergeScores` to accept rank-based inputs from both
  sides (either name is fine — pick based on whether `mergeScores`'s existing unit tests in
  `semantic-search.test.ts` are cheaper to adapt or replace; `mergeScores` is a small, fully
  covered function, so check with `git blame`/test names before deciding to keep the name or add
  a sibling).
- In `packages/mcp/src/smart-context.ts`'s `buildSmartContext` (around line 420-437):
  extend `keywordResults` from a fixed `40` to `Math.max(40, maxNodes * 4)` so the keyword
  ranker's candidate list isn't truncated before fusion has a chance to reconsider it.
- In `semantic-search.ts`'s `semanticScoreNodes` (:47-66): drop the `.filter(scored =>
  scored.semanticScore > 0)` — with normalized embeddings (embeddings.ts already calls `embed`
  with `normalize: true`), nearly every node has nonzero cosine similarity, so this filter barely
  filters anything and forces a full-graph sort where a partial top-K selection would do. Replace
  with a bounded top-K selection (e.g. a simple sort + slice is fine at current graph sizes;
  revisit only if profiling on a large project shows it matters).
- Update `docs/architecture/SMART-CONTEXT.md` to describe RRF, not the old weighted-sum
  description, so the doc matches the code again.

## Out of scope

- Tuning the `k=60` RRF constant or the keyword/semantic weight split — ship the standard default
  first, measure with the harness, tune only if the numbers say to.
- Changing what `findRelevantNodes` itself scores on (that's spec 068 — IDF/identifier-aware
  keyword scoring). This spec only fixes how keyword and semantic rankings combine.
- Changing embedding content (that's spec 067).

## Design

RRF over the two existing ranked lists (`findRelevantNodes`'s keyword ranking,
`semanticScoreNodes`'s semantic ranking), weighted the same 0.4/0.6 split the code already
intends — the fix is score *combination*, not re-deciding the weight balance. Both input lists
already exist in `buildSmartContext`; this spec changes what happens between "compute both
rankings" and "take the top `maxNodes`", not the ranking computations themselves (those are 067
and 068's job).

## Acceptance criteria

- [ ] `mergeScores`/`fuseByRRF` combines two rank-based inputs via RRF, unit-tested directly:
      a node ranked #1 by both rankers beats one ranked #1 by only one; a node absent from a
      ranker's list is treated as unranked (contributes 0 from that ranker), not as rank 0.
- [ ] `docs/architecture/SMART-CONTEXT.md` updated to match.
- [ ] Re-run `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings` before and after;
      record both aggregates in this spec's Success Metrics section once implemented. Expect
      `py-10`-shaped queries (no lexical overlap) to improve; expect the CI-gated keyword-only
      `retrieval-eval.test.ts` floor to be unaffected (this spec doesn't touch the keyword-only
      path) — if it moves, something scoped wrong.
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

`semantic-search.test.ts` — RRF fusion: known rank inputs → known fused order; a node unranked
by one side still gets a score from the other; weight parameters change relative ordering
predictably (heavier semantic weight favors semantically-close-but-lexically-distant nodes).

`smart-context.test.ts` — existing hybrid-path tests should still pass structurally (same
function signature, different internal scoring); add a case with a query that has zero lexical
overlap with a node's label but high semantic similarity (mirrors the `py-10` golden-set case)
and assert that node now appears in the top results, where before this fix it wouldn't have.

## Success Metrics

Fill in after implementation: `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings`
aggregate (Recall@10/nDCG@10/MRR) before vs. after, specifically on the queries with low lexical
overlap (`py-10`-shaped). This is the first real test of the spec 063 harness's reason for
existing.

## Related

Depends on: spec 063 (the harness this validates against). Blocks: none downstream, but 067/068
compound with this — fixing fusion without also improving what's being fused (067's richer
embeddings, 068's IDF-weighted keyword scoring) leaves headroom on the table.
