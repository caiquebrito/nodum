# 064 — Compute the north-star metric: tokens per correct answer

## Status: done

Implemented and tested (18 new tests across `benchmarks/metrics.test.ts` and
`benchmarks/baseline-store.test.ts`; full workspace suite green via `npm test --workspaces`).
Real check: `npx tsc --noEmit` over every changed `benchmarks/*.ts` file with no errors (the
same offline check the module's own posture relies on, since `benchmarks/` has no dedicated
build step — see spec 028).

## Goal

Make `docs/development/ROADMAP.md`'s declared success metric — *"tokens spent per correct agent
answer, tracked per release against real repositories"* — a real, computed number, not just a
sentence in a doc.

## Why now

`benchmarks/metrics.ts::aggregateResults()` already computes `avgTokenReduction` and
`avgAccuracyGain` as two **separate** averages. Nothing in the codebase divides one by the other
— the metric the roadmap commits to has never actually been produced. Worse, every number the
harness reports today is a single sample: `ClaudeAPI.callWithRetries()` already calls the API
three times per question (to average token/latency noise) but only ever **scored the first
response's accuracy** — so `accuracyGain` carried zero information about its own run-to-run
variance, making any release-over-release delta unfalsifiable (a number could move for no reason
other than model sampling noise, and nothing would catch that).

This directly follows spec 063: that spec built the offline retrieval-quality gate; this spec
makes the LLM-facing side of "did this actually get better" real too, ahead of specs 066-068
actually changing ranking behavior in `packages/mcp`.

## Scope

- **`benchmarks/metrics.ts`**:
  - `aggregateResults()` now computes `tokensPerCorrectAnswer` — total with-graph tokens divided
    by total "correct answer credit" (`Σ accuracy/100` across questions, i.e. a 100%-accurate
    answer counts as one full correct answer, a 50%-accurate one as half). Scored against the
    **with-graph** condition specifically — that's the configuration nodum actually ships; the
    no-graph baseline exists to measure improvement, not to be a competing "tokens per correct
    answer" figure. Reports `Infinity` (not `0` or `NaN`) when no question earned any accuracy
    credit, so a broken run reads as broken rather than as a perfect score.
  - New `summarizeAccuracyRuns(scores: number[])` — mean + standard error across repeated-run
    accuracy scores.
  - New `standardError()` / `propagatedRatioStdErr()` helpers — the latter propagates each
    question's own `accuracyStdErr` (when populated) into `tokensPerCorrectAnswerStdErr` via the
    standard independent-variance addition rule, so the aggregate doesn't claim more precision
    than its inputs support.
- **`benchmarks/claude-api.ts`**: `callWithRetries()` now additionally returns `allResponses` and
  `allMetrics` (every individual run, not just the averaged view) — additive, existing callers
  (`v2-comparison.ts`) that destructure only `{ response, metrics }` are unaffected.
- **`benchmarks/harness.ts`**: scores accuracy against **every** retried response (via the new
  `allResponses`) instead of just the first, feeding `summarizeAccuracyRuns()` to populate
  `accuracy`/`accuracyStdErr` on each `QuestionResult`. Reads the running nodum version from root
  `package.json` (the lockstep `fixed` Changesets group means one version covers all four
  packages), writes/reads a stored baseline (see below), and prints the metric plus its
  release-over-release delta to the console.
- **`benchmarks/baseline-store.ts`** (new) — `writeBaseline`/`loadPreviousBaseline`/
  `diffAgainstBaseline`, storing one JSON file per released version under
  `benchmarks/baselines/<version>.json`. `loadPreviousBaseline` finds the highest stored version
  strictly less than the current one, so the nightly workflow can report a real before/after
  instead of an absolute number with no reference point. Flat committable JSON files, matching
  this project's existing storage posture (`graph.json`, `metrics.jsonl`) rather than a database.
- **`benchmarks/report-generator.ts`**: new "Tokens / Correct Answer" metric card (with its
  stderr, when available, and the delta-vs-previous-release line when a prior baseline exists),
  plus a line in the existing "Key Findings" box.
- **`benchmarks/datasets/schema.ts`**: `QuestionResult.baseline`/`withGraph` gain an optional
  `accuracyStdErr`; `BenchmarkSummary` gains `nodumVersion` and
  `aggregate.tokensPerCorrectAnswer`/`tokensPerCorrectAnswerStdErr`; new `StoredBaseline` type.

## Out of scope

- **Running the harness for real** — this spec makes the computation real; actually spending
  `ANTHROPIC_API_KEY` budget to produce the first real baseline is the same kind of one-time,
  repo-owner-triggered step spec 028 already deferred for the accuracy workflow itself. The first
  `benchmarks/baselines/*.json` file gets written the next time `benchmark-accuracy.yml` runs (or
  someone runs `npm run run:sample` locally with a key).
- **A CI check that fails when `tokensPerCorrectAnswer` regresses.** `benchmark-accuracy.yml`
  already isn't a PR gate (real spend, nightly-only) — turning a metric regression into a hard
  failure there is a policy decision for whoever's watching the nightly output, not something to
  bake in silently here.
- **Increasing `retries` beyond the current 2 in `harness.ts`'s calls.** More repeats would
  tighten `accuracyStdErr` further but costs proportionally more API spend; left as a future
  tuning knob once real baseline data shows whether today's variance is actually a problem.

## Design

`tokensPerCorrectAnswer = totalWithGraphTokens / Σ(withGraph.accuracy / 100)` — a ratio, not an
average of ratios, so one question with near-zero accuracy (denominator near zero) doesn't
produce a wild per-question outlier that dominates a naive mean; using totals keeps it well-
behaved and matches how `tokensSaved` is already computed (from totals, not from averaging
per-question percentages).

Variance propagation: for independent per-question accuracy fractions, `Var(Σaᵢxᵢ) = Σaᵢ²Var(xᵢ)`
where `aᵢ` is the partial derivative of the ratio with respect to question `i`'s accuracy,
holding the others fixed — the standard first-order (delta-method) approximation for propagating
uncertainty through a ratio of sums. Only computed when at least one question actually carries a
nonzero `accuracyStdErr`; otherwise `tokensPerCorrectAnswerStdErr` is left `undefined` rather than
reported as a misleadingly precise `0`.

## Acceptance criteria

- [x] `aggregateResults()` returns a real `tokensPerCorrectAnswer` number computed from its
      inputs (verified by direct unit test against hand-computed expected values).
- [x] `tokensPerCorrectAnswer` is `Infinity`, not `0` or `NaN`, when total accuracy credit is zero.
- [x] `summarizeAccuracyRuns()` returns `stdErr: 0` for a single sample and a positive value when
      samples disagree.
- [x] `tokensPerCorrectAnswerStdErr` is `undefined` when no question supplies `accuracyStdErr`,
      and positive when at least one does.
- [x] `baseline-store.ts` round-trips a written baseline, correctly picks the highest version
      strictly below the current one among several stored baselines, and produces a negative
      delta for an improvement and positive for a regression.
- [x] `harness.ts` scores accuracy against every retried response, not just the first.
- [x] `npm run build && npm test --workspaces` green; `npx tsc --noEmit` clean on every changed
      file.

## Test plan

`metrics.test.ts` — `tokensPerCorrectAnswer` against a hand-computed two-question case; the
`Infinity` edge case; stderr `undefined` when absent vs. positive when present;
`summarizeAccuracyRuns` mean/stdErr across 1, agreeing, and disagreeing samples.

`baseline-store.test.ts` (new) — write/read round-trip in an isolated temp directory (never
touching the real `benchmarks/baselines/`); `null` when no baseline directory exists yet or when
every stored baseline is not strictly older than the current version; correct highest-prior-
version selection among several stored files; delta sign/magnitude for both improvement and
regression cases.

## Success Metrics

Real check: `npx tsc --noEmit` (loose config matching this workspace's existing `moduleResolution:
node`/`ESNext` posture) over every changed file, zero errors. `npm test --workspaces` green
(20 new tests in `benchmarks/`, no change to the 815 tests elsewhere). The actual first measured
`tokensPerCorrectAnswer` value is deferred to the next real `benchmark-accuracy.yml` run (see Out
of scope) — this spec's job was making the number computable and comparable release-to-release,
not producing the first data point.

## Related

Depends on: spec 063 (this is the LLM-facing half of the same "make the north-star metric real"
goal; 063 covers retrieval quality independent of any LLM call). Feeds: `docs/development/
ROADMAP.md`'s Success metrics section, updated to point at this implementation. Reuses
`benchmarks/claude-api.ts`'s existing retry infrastructure (spec 028) rather than adding a new
one.
