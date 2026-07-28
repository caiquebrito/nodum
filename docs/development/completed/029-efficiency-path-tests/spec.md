# 029 — Unit tests for the efficiency path

## Status: done

Implemented and tested. `@caiquebrito/nodum-mcp`'s suite went from 24 tests (3 files) to 58 tests
(5 files) — 13 new in `semantic-search.test.ts`, 9 new in `conversation-cache.test.ts`, 12 added
to `smart-context.test.ts`. Full workspace suite — 196 core, 95 cli, 58 mcp, 8 benchmarks, 357
total — green.

## Goal

Close the coverage gap the v2.2.0 exploration surfaced: the three headline v2.0 features —
`smart-context.ts`, `semantic-search.ts`, `conversation-cache.ts` — had zero unit tests before
024–028 started adding to `smart-context.ts` incidentally. Coverage currently mirrors the
project's release timeline (every v2.1 analyzer is well tested; the v2.0 efficiency code isn't),
not its actual risk — and this is the code path this entire release has been changing.

## Why now

Last spec in the v2.2.0 batch, deliberately. Every prior spec (024–028) touched
`smart-context.ts` and left behind partial, incidental test coverage for whatever it happened to
change; this spec is the one that goes back and covers what's still untested — `semantic-search.ts`
and `conversation-cache.ts` in full, plus the parts of `smart-context.ts` no prior spec had a
reason to touch (`extractKeywords`, `scoreNode`, `findRelevantNodes`, `formatContextText`,
`buildNodeContext`).

## Scope

- `packages/mcp/src/semantic-search.test.ts` (new): `cosineSimilarity` (identical vectors → 1,
  orthogonal → 0, mismatched lengths / undefined → 0, zero-magnitude vector → 0 not NaN);
  `semanticScoreNodes` (filters out zero/negative scores, sorts descending, treats a missing
  `embedding` as score 0); `mergeScores` (weighted combination, default 0.4/0.6 weights);
  `getTopScoredNodes` (sorts by `finalScore`, respects `topK`); `findSemanticNeighbors`
  (returns results unchanged once `targetCount` is met; extends via average-embedding similarity
  when short; returns results as-is when nothing has embeddings to extend with).
- `packages/mcp/src/conversation-cache.test.ts` (new): `cacheContext` + `getRelatedContext`
  round-trip on a hit; miss on insufficient keyword overlap (below the 50% Jaccard threshold —
  intersection over union, not intersection over either list, worth pinning down precisely since
  the doc comment just says "50% overlap"); miss on a different, never-seen project; TTL expiry
  (using fake timers — this is a real 5-minute wall-clock TTL, not something to actually wait
  out); `clearProject` invalidates immediately; `cleanupExpired` removes only stale entries, not
  fresh ones; `getStats` reflects post-cleanup counts.
- `packages/mcp/src/smart-context.test.ts` (extend): `extractKeywords` (stopword filtering,
  length-3 minimum, splitting on `. - _ /`); `scoreNode` (exact label match outranks substring,
  file-path and type matches contribute independently); `findRelevantNodes` (sorts by score,
  respects `limit`, excludes zero-score nodes); `formatContextText` via `buildSmartContext`
  (cluster summary shown once per cluster instead of per member node; non-clustered nodes grouped
  by file); `buildNodeContext` (currently has **zero** coverage anywhere in the codebase —
  dependencies/dependents listing, the existing `.slice(0, 10)` + "... and N more" truncation,
  and the not-found path).

## Out of scope

- A coverage-percentage floor enforced in `vitest.config.ts` — the v2.2.0 plan raised this as a
  "consider," not a commitment. Adding a hard threshold now, right after manually verifying these
  three files are covered, would be enforcing a number chosen to match what was just written
  rather than a deliberately chosen bar. A future spec can set one once there's a reason to defend
  a specific number.
- Testing `embeddings.ts` beyond what specs 024/027 already added (`hasEmbeddings`'s zero-guard,
  the pipeline-failure fallback) — it's not one of the three files named in the v2.2.0 plan, and
  its existing coverage (5 tests) is already reasonable.
- Refactoring `ConversationCache` to accept an injectable clock for easier testing — fake timers
  (`vi.useFakeTimers`) test the real TTL behavior directly without needing a design change this
  spec has no other reason to make.

## Design

Almost entirely new test files — but not quite zero production changes, corrected from the
original framing: `extractKeywords`, `scoreNode`, and `findRelevantNodes` in `smart-context.ts`
were module-private (no `export`) and needed direct coverage per Scope, not just indirect
coverage through `buildSmartContext`'s public output. Exported all three — a behavior-preserving
change (pure functions, no logic touched), but a real new-public-export change to
`@caiquebrito/nodum-mcp`'s surface, so it gets a changeset like 024's `countTokens` export did.
See Scope for what each test file covers; the test bodies are the deliverable, not worth
restating as pseudocode here.

## Acceptance criteria

- [x] `semantic-search.ts`: every exported function has direct test coverage, including the
      zero-magnitude and mismatched-length edge cases `cosineSimilarity` guards against.
- [x] `conversation-cache.ts`: hit, miss (low overlap), miss (unknown project), TTL expiry (via
      fake timers, not a real wait), and all four other public methods are covered.
- [x] `smart-context.ts`: `extractKeywords`, `scoreNode`, `findRelevantNodes`, and
      `buildNodeContext` all gain direct coverage; `buildNodeContext` specifically goes from zero
      coverage to real coverage including its truncation and not-found paths.
- [x] `npm run build && npm test --workspaces` green, with the mcp package's test count
      substantially higher than before this spec.

## Test plan

This spec's Scope section *is* the test plan — every bullet above names the file and the cases
it adds. No separate restatement.

## Success Metrics

- Real check: `@caiquebrito/nodum-mcp`'s suite went from 24 tests across 3 files to 58 tests
  across 5 files — `semantic-search.test.ts` (13, new), `conversation-cache.test.ts` (9, new),
  `smart-context.test.ts` (17, up from 6).

## Related

Depends on: 024–027 (the `smart-context.ts` behavior this spec covers, including the changes
those specs made). Closes out the v2.2.0 batch — only the release PR follows this spec.
