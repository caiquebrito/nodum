# 063 — Offline retrieval evaluation harness

## Status: done

Implemented and tested (16 new `benchmarks/retrieval/ir-metrics.test.ts` unit tests + 1 new
`benchmarks/retrieval/retrieval-eval.test.ts` regression gate; full workspace suite — 602 core,
102 cli, 15 server, 91 mcp, 25 benchmarks, 835 total — green via `npm test --workspaces`). Real
check: ran `npx tsx benchmarks/retrieval/retrieval-eval.ts` against both fixture projects and
confirmed it surfaces a genuine, expected gap — see "What the harness immediately found."

## Goal

Add a way to score Nodum's retriever — `findRelevantNodes`/`buildSmartContext`'s node-selection
logic — against a labeled ground truth, deterministically and offline, with no LLM in the loop.

## Why now

The project's only existing accuracy measurement (`benchmarks/harness.ts` + `scoreAccuracy()`,
spec 028) scores the LLM's *final answer text* against expected keywords. That's the right thing
to measure end-to-end, but it can't isolate retrieval quality: a ranking change can only be
validated by running the full harness against `ANTHROPIC_API_KEY` (real spend, real latency,
`workflow_dispatch`/nightly only — never on a PR), and even then the result is confounded by
whatever the model does with the context it's given. There is currently no way to answer "did
this change to `smart-context.ts` actually rank more relevant nodes higher" without spending
money and waiting for a cron.

This blocks the retrieval-accuracy work already identified as high-value (see the
`docs/development/ROADMAP.md` v2.18.0 section this spec opens): a real hybrid-scoring bug
(mismatched keyword-rank vs. cosine-similarity scales feeding `mergeScores`) and embeddings built
from almost no signal (`label + type` only) can't be fixed with confidence if there's no cheap
way to prove a fix actually improved ranking rather than just changing it.

This spec follows the same precedent spec 027's token-ceiling test and spec 028 itself already
established: a cheap, deterministic assertion that runs on every PR, guarding a property the
expensive nightly benchmark can only observe indirectly.

## Scope

- **`benchmarks/retrieval/golden-set.json`** — 26 labeled queries against the two existing
  fixture projects (`benchmarks/projects/sample-next-app`, `python-hub-app`), each specifying the
  nodes a good retriever must surface as `{ file, label, type }` selectors rather than raw graph
  node ids. Selectors, not ids, are the source of truth: ids are a derived encoding
  (`normalizeNodeId` in `packages/core/src/types.ts`) and selectors stay meaningful even if that
  encoding changes. Deliberately scoped to the two synthetic fixtures, not this repo's own graph
  — keeps the regression gate stable across nodum's own churn (see Out of scope).
- **`benchmarks/retrieval/ir-metrics.ts`** — pure, dependency-free functions: `recallAtK`,
  `precisionAtK`, `reciprocalRank`, `ndcgAtK` (binary relevance, log2-discounted, normalized
  against the ideal ranking), plus `scoreQuery`/`aggregateIRMetrics` to roll per-query metrics
  into a summary. Unit-tested directly (`ir-metrics.test.ts`), no fixture/graph involved.
- **`benchmarks/retrieval/resolve.ts`** — resolves a golden-set selector against a real generated
  `Graph`, matching on `(file, label, type)`. Deliberately strict: a selector matching zero or
  more than one node throws rather than silently scoring against the wrong node or an empty set —
  a golden set that's drifted out of sync with its fixture source should fail loudly, not
  under-count relevance quietly.
- **`benchmarks/retrieval/retrieval-eval.ts`** — the runner. Loads the golden set, generates each
  fixture's graph once via `generateGraph` (from `@caiquebrito/nodum-core`), and scores the
  keyword ranker (`findRelevantNodes`) by default. `--embeddings` additionally scores the hybrid
  keyword+semantic ranker via the sibling `hybrid-eval.ts` module — split out because it needs to
  load `@xenova/transformers` and download the local embedding model (network on first run), so
  it's opt-in for local investigation, not part of the CI gate.
- **`benchmarks/retrieval/retrieval-eval.test.ts`** — the CI-gated regression check. Scores only
  the keyword ranker (deterministic, no model download) against measured floors:
  `recall@10 ≥ 0.9`, `nDCG@10 ≥ 0.75`, `MRR ≥ 0.7` — set from the actual current aggregate
  (`recall@10=0.962, ndcg@10=0.814, mrr=0.756`) with margin. Runs under `npm test --workspaces`
  automatically, same as `context-size.test.ts` (spec 028) — no `ci.yml` changes needed.
- **Fixed `benchmarks/context-size.test.ts`'s stale positional-argument call**, found while
  building this: spec 041 replaced `buildSmartContext`'s `(query, graph, maxNodes, cache)`
  positional signature with a `SmartContextOptions` object, but this test still called
  `buildSmartContext('login', normalGraph, 25)` — `25` destructured to `options`, which is
  all-undefined, so `maxNodes` silently fell back to its own default (also `25`), and the test
  passed by coincidence while no longer exercising what it appeared to. Now passes
  `{ maxNodes: 25 }` explicitly.

## Out of scope

- **Scoring the hybrid semantic ranker in the CI gate.** It requires downloading and running the
  local embedding model on first use — real network dependency and real latency that a
  deterministic, every-PR gate shouldn't carry. `retrieval-eval.ts --embeddings` covers it for
  local/manual verification when spec 066-068 change the semantic path.
- **This repo's own graph as a golden-set target.** Spec 026 named it as a benchmark target and
  it's a good large-scale smoke test, but its ground truth would need re-curating every time this
  codebase's own structure changes — the opposite of a stable regression gate. Left as a future
  addition once the small-fixture harness has proven itself.
- **Wiring `tokensPerCorrectAnswer` or any LLM-facing metric** — that's spec 064's job, on top of
  `benchmarks/metrics.ts`, not this harness.
- **Fixing the hybrid scoring bug itself** (mismatched keyword-rank vs. cosine-similarity scales
  in `mergeScores`) — this spec only builds the instrument that proves spec 066's fix works.

## Design

See Scope for the file list. The key structural decision: **selectors, not ids, in the golden
set.** An earlier draft considered hardcoding node ids directly (`normalizeNodeId` output is
deterministic, e.g. `src_lib_auth_ts__generatetoken`), but that ties the golden set to an
internal encoding detail that has already changed once (methods are now `${class}#${method}`,
spec-era). `{ file, label, type }` selectors, resolved against a freshly generated graph at eval
time, survive that kind of change and fail loudly (via `resolve.ts`'s strict zero/many check) if
the fixture source itself drifts.

## Acceptance criteria

- [x] `benchmarks/retrieval/ir-metrics.ts` exports `recallAtK`, `precisionAtK`,
      `reciprocalRank`, `ndcgAtK`, `scoreQuery`, `aggregateIRMetrics`, all pure and unit-tested.
- [x] `benchmarks/retrieval/golden-set.json` has labeled queries against both existing fixtures.
- [x] `npx tsx benchmarks/retrieval/retrieval-eval.ts` runs standalone and prints per-query and
      aggregate Recall@k/Precision@k/MRR/nDCG for the keyword ranker.
- [x] `benchmarks/retrieval/retrieval-eval.test.ts` runs under `npm test --workspaces` with zero
      network calls and zero Anthropic API usage.
- [x] `benchmarks/context-size.test.ts`'s stale positional-arg call is fixed.
- [x] `npm run build && npm test --workspaces` green (835 tests).

## Test plan

`ir-metrics.test.ts` — each metric function against hand-computed cases: perfect ranking,
partial ranking, nothing relevant found, vacuous "nothing to find" cases, and aggregation across
multiple queries including the empty-input edge case.

`retrieval-eval.test.ts` — generates both fixture graphs once (`beforeAll`), runs the full golden
set through the keyword ranker, and asserts the aggregate stays at or above the measured floor.

## Success Metrics

Real check: `npx tsx benchmarks/retrieval/retrieval-eval.ts` against both fixtures.

## What the harness immediately found

Running it surfaced a real, expected gap rather than a clean 100% across the board: query `py-10`
("shared utilities used by every module in the app" — no lexical overlap with `get_db_connection`,
`log`, or `Config`) scores `recall@10=0.00` under the keyword ranker, while every other query
(which does have lexical overlap with its target's label) scores `recall@10=1.00`. Aggregate:
`recall@5=0.962, recall@10=0.962, precision@10=0.443, mrr=0.756, ndcg@10=0.814`. This is exactly
the blind spot the semantic-search half of `buildSmartContext` exists to cover — and per spec
066's finding, that half is currently near-disabled by a score-scale bug. This harness is what
will prove whether specs 066-068 actually close gaps like `py-10`, not just move numbers around.

## Related

Depends on: `countTokens` infrastructure is not used here (IR metrics need no tokenizer), but
follows the same "measured, not asserted" posture spec 024-026 established. Reuses the fixture
projects spec 028 added. Blocks: 064 (north-star metric), 066-068 (retrieval accuracy fixes,
each validated against this harness).
