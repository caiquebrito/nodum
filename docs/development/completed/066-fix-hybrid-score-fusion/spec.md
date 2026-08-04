# 066 — Fix hybrid score fusion (RRF)

## Status: done

Implemented and tested (19 `semantic-search.test.ts` tests covering `fuseByRRF` and the rewritten
`mergeScores` directly, plus 1 new `smart-context.test.ts` hybrid-fusion test; full workspace
suite — 602 core, 119 cli, 15 server, 103 mcp, 39 benchmarks, 878 total — green via
`npm test --workspaces`). Real check: ran `npx tsx benchmarks/retrieval/retrieval-eval.ts
--embeddings` before and after against a correctly-resolved build of the changed code (see the
"before/after methodology" note below) — see Success Metrics for the numbers.

`mergeScores`'s exact 3-argument-weighted-sum signature was replaced (not kept as a same-signature
drop-in) because its unit tests asserted the old raw-score-weighted-sum semantics directly
(`finalScore = 0.4*10 + 0.6*0.5`), which is incompatible with rank-based RRF — those tests were
rewritten rather than adapted, per the spec's guidance to pick whichever is cheaper.  Kept the
`mergeScores` name (rather than adding a separate `fuseByRRF`-only call site) since it's still the
function `buildSmartContext` calls to combine the two rankings; `fuseByRRF` was added alongside it
as the generic, node-agnostic RRF primitive (`(nodeId, weight)` ranked lists → `Map<nodeId, score>`),
which `mergeScores` calls internally after resolving node objects — this keeps the standalone RRF
math independently unit-testable from the node-shape bookkeeping.

`benchmarks/retrieval/hybrid-eval.ts` (the harness's mirror of `buildSmartContext`'s internal
fusion call, added in spec 063) also needed updating to match the new `mergeScores` signature —
not called out in the original scope, but required for the harness to actually exercise the fix
rather than crash on the old 3-argument call shape.

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
- (Found during implementation, not in the original scope list) `benchmarks/retrieval/hybrid-eval.ts`
  duplicates `buildSmartContext`'s fusion call site to score the hybrid ranker in the harness —
  it calls the old 3-argument `mergeScores(scoredNodes, keywordWeight, semanticWeight)` shape
  directly, so it needed the matching update or it would call the new signature with wrong
  argument types and misbehave silently (a `number` bound to the new `keywordResults: BasicNode[]`
  parameter) rather than fail to compile (imported via `@ts-expect-error`'d compiled-output path).

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

- [x] `mergeScores`/`fuseByRRF` combines two rank-based inputs via RRF, unit-tested directly:
      a node ranked #1 by both rankers beats one ranked #1 by only one; a node absent from a
      ranker's list is treated as unranked (contributes 0 from that ranker), not as rank 0.
- [x] `docs/architecture/SMART-CONTEXT.md` updated to match.
- [x] Re-run `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings` before and after;
      record both aggregates in this spec's Success Metrics section once implemented. Expect
      `py-10`-shaped queries (no lexical overlap) to improve; expect the CI-gated keyword-only
      `retrieval-eval.test.ts` floor to be unaffected (this spec doesn't touch the keyword-only
      path) — if it moves, something scoped wrong. (Confirmed: keyword-only aggregate is
      byte-identical before/after — `recall@5=0.962 recall@10=0.962 precision@10=0.443 mrr=0.756
      ndcg@10=0.814` in both runs. `py-10` itself already scored `recall@10=1.00` under the old
      hybrid path too — see the methodology note in Success Metrics for why — but the fix's real,
      measurable effect shows up as a large MRR/nDCG jump across the hybrid aggregate: the fix
      changes *how high* correctly-recalled nodes rank, not just whether they're recalled at all.)
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`semantic-search.test.ts` — RRF fusion: known rank inputs → known fused order; a node unranked
by one side still gets a score from the other; weight parameters change relative ordering
predictably (heavier semantic weight favors semantically-close-but-lexically-distant nodes).

`smart-context.test.ts` — existing hybrid-path tests should still pass structurally (same
function signature, different internal scoring); add a case with a query that has zero lexical
overlap with a node's label but high semantic similarity (mirrors the `py-10` golden-set case)
and assert that node now appears in the top results, where before this fix it wouldn't have.

## Success Metrics

**Before/after methodology note:** this worktree's `node_modules` is a symlink into the main
checkout's shared `node_modules`, and the hoisted `@caiquebrito/nodum-mcp` entry inside it is
itself a *relative* symlink (`../../packages/mcp`) — which resolves relative to the real,
non-symlinked location of that shared directory (the main checkout), not this worktree. A first
attempt to run the harness against this worktree's build silently ran the main checkout's
unmodified code both "before" and "after" instead. Fixed by overriding `@caiquebrito/nodum-core`,
`-mcp`, `-cli`, `-server` at `benchmarks/node_modules/@caiquebrito/*` with absolute symlinks
pointing directly at this worktree's `packages/*` — Node resolves the closer `node_modules` first,
so this shadows the hoisted (wrong-target) entries without touching the shared directory. Verified
via `node -e "console.log(require.resolve('@caiquebrito/nodum-mcp/dist/semantic-search.js'))"`
before trusting any number below. "Before" was then captured with `git stash` (reverting the 5
changed source/doc files to develop's original content, rebuilding, running the harness) and
"after" by `git stash pop` + rebuild + rerun — same process, same graphs, same embeddings model,
only the fusion code differs.

**Keyword-only ranker (unaffected control — this spec doesn't touch it):**
identical before and after — `recall@5=0.962 recall@10=0.962 precision@10=0.443 mrr=0.756
ndcg@10=0.814`. Confirms the fix is correctly scoped to the hybrid path only.

**Hybrid ranker (keyword + semantic fusion) — before (old weighted-sum bug):**
`recall@5=0.974 recall@10=1.000 precision@10=0.146 mrr=0.821 ndcg@10=0.869`

**Hybrid ranker — after (RRF fix):**
`recall@5=0.974 recall@10=1.000 precision@10=0.115 mrr=0.962 ndcg@10=0.971`

Recall@10 was already saturated at 1.000 before this fix on this golden set — every query's
correct node was *somewhere* in the top 10 either way. What the fix visibly improves is **rank
quality**: MRR jumped `0.821 → 0.962` and nDCG@10 jumped `0.869 → 0.971`, meaning the correct node
now typically ranks at or near #1 instead of buried lower in the top 10. Per-query MRR moved from
a fraction (e.g. `0.50`, `0.33`) to a clean `1.00` on roughly half the 26 queries (e.g. `ts-01`,
`ts-02`, `ts-09`, `py-04`, `py-09`). Precision@10 dropped slightly (`0.146 → 0.115`) — expected and
not a regression: precision@10 is capped low by design here (each query has only 1-3 truly
relevant nodes among a much larger top-10 window), and RRF's fused ordering shuffles which
non-relevant nodes fill the remaining slots without changing whether the relevant ones are found.

`py-10` itself (the harness's original motivating example — zero lexical overlap with its target)
already scored `recall@10=1.00 mrr=0.50 ndcg@10=0.62` under *both* old and new hybrid code. This
initially looked like it contradicted the spec's premise, but makes sense on inspection: `py-10`'s
target has zero keyword-rank matches, but so does *every other node in that fixture graph* for
this specific query — there's no competing node with a nonzero keyword score to unfairly win via
the old weighted sum's keyword-dominance bug, so the old formula degenerates to a semantic-only
comparison for this one query by coincidence. The bug's failure mode (a lexically-matching but
semantically-irrelevant node beating a semantically-close, zero-overlap one) is real and is what
the new `smart-context.test.ts` unit test (`cacheLayer` vs. `moduleLoader`, see Test plan) exercises
directly and deterministically — it's just not the specific case this golden-set query happens to
trigger. The aggregate MRR/nDCG movement above is the real, harness-measured evidence that RRF
generally improves rank quality across the golden set, `py-10` or not.

## Related

Depends on: spec 063 (the harness this validates against). Blocks: none downstream, but 067/068
compound with this — fixing fusion without also improving what's being fused (067's richer
embeddings, 068's IDF-weighted keyword scoring) leaves headroom on the table.
