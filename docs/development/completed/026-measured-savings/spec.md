# 026 — Replace asserted savings with measured savings

## Status: done

Implemented and tested (4 new `packages/mcp/src/smart-context.test.ts` cases — this file didn't
exist before this spec; full test coverage of `smart-context.ts` is spec 029's job, this adds
only what 026 itself touches; full workspace suite — 196 core, 95 cli, 19 mcp, 310 total —
green). Real check: ran the compiled MCP server against a broad query and a narrow query on this
repo's own synced graph — broad returned `97% fewer tokens than a full graph dump`, narrow
returned `100%` — a real, non-hardcoded number that moves in the expected direction. Also found
and fixed a second hardcoded percentage this spec's own acceptance criteria would otherwise have
missed: a stale `"saves 50% tokens"` comment on `formatContextText`.

## Goal

Delete the hardcoded percentage strings from `buildSmartContext()`'s response text and replace
them with numbers actually computed from this call, using the `countTokens`/`approxTokens`
machinery 024 added and 025 now logs. Wire up `estimateTokenSavings()` (`smart-context.ts:411`),
which has existed since v2.0 and has never once been called.

## Why now

024 made a token count computable; 025 made it observable in real sessions. This is the spec
that actually stops asserting the numbers and starts computing them — the whole reason v2.2.0
exists. It has to land after both, since it needs `countTokens` (024) to build a comparison
baseline, and its correctness is easiest to sanity-check against 025's real-session log output.

## Scope

- `packages/mcp/src/smart-context.ts`: add `buildRawGraphDump(graph): string` — a plain-text
  listing of every node and edge, representing "what dumping the entire graph, unfiltered, would
  cost." This is the actual `fullGraphTokens` baseline `estimateTokenSavings()` has always wanted
  and never had; nothing in the codebase currently produces one.
- In `buildSmartContext()`'s main return path: compute `countTokens(buildRawGraphDump(graph))`
  once, call the existing `estimateTokenSavings(rawDumpTokens, approxTokens)`, and interpolate
  the real `percentage` into the response text in place of the hardcoded `40-60%`.
- **A correction, not just a computation.** The other two hardcoded claims don't have a
  measurable analog in the current architecture, and this spec says so plainly rather than
  inventing a number to fill the slot:
  - *"83% more reduction on cache hit"* — a cache hit reuses the exact same `expandedIds` a miss
    would have computed, so it produces byte-identical formatted text and an identical token
    count. There is no token saving from a cache hit in this architecture; the saving is in
    compute (skipped scoring/embedding), not context size. The 83% figure traces back to
    `CHANGELOG.md`'s v2.0 entry, which described a different, no-longer-present pre-clustering
    architecture. Replaced with a plain, non-numeric "served from cache" note.
  - *"20% better selection via semantic search"* — an accuracy claim, not a token-efficiency one,
    and this spec's scope is tokens. No accuracy-eval harness exists in the production code path
    to measure "better" against (the benchmark suite's `scoreAccuracy()` is a separate, offline
    thing — and 028 is already flagged as needing a precision term before its numbers can be
    trusted either). Replaced with a plain, non-numeric "semantic search enabled" note.
- `estimateTokenSavings()`: guard the existing division against a zero-node graph
  (`fullGraphTokens === 0` would currently produce `NaN%` — dead code has never hit this edge
  case because nothing called it).
- `README.md`'s `## v2.0 Optimizations` and `## Benchmarks` sections assert the same three
  percentages as historical fact. Reframe them as the original v2.0 design targets rather than
  ongoing measured truth, and point at where real numbers now live (per-call in the MCP response
  itself, logged per-session in `metrics.jsonl`) instead of asserting a single fixed number that
  was never true for every project shape.

## Out of scope

- Caching `buildRawGraphDump()`'s token count across calls within a session — it's identical
  every time until the next sync, so recomputing it per query is wasteful, but performance work
  is v2.5's job (adaptive context budgeting), not this spec's.
- Building a real accuracy-eval harness to justify a semantic-search percentage — that's what
  028's benchmark-harness precision work is for, and even then it measures the benchmark's fixed
  fixture, not a live claim embeddable in every response.
- Rewriting README's benchmark numbers into new, precisely measured replacements — that requires
  running the (still being fixed, per spec 028) benchmark suite across representative projects.
  This spec removes the false precision; it doesn't manufacture new precision to replace it with.
- Any change to `expandContext()`'s behavior or output size — that's 027's job specifically, and
  027's before/after number is only meaningful once this spec's real percentage exists to quote.

## Design

### 1. `packages/mcp/src/smart-context.ts` — `buildRawGraphDump`

```ts
/**
 * Plain-text dump of every node and edge — the "no smart context" baseline
 * `estimateTokenSavings()` compares against. Deliberately unformatted (no
 * clustering, no truncation) since it represents the cost of NOT doing any
 * of that.
 */
function buildRawGraphDump(graph: Graph): string {
  const nodeLines = graph.nodes.map(
    (n) => `${n.id} | ${n.label} (${n.type}) | ${n.file ?? ""}`
  );
  const edgeLines = graph.edges.map(
    (e) => `${e.source} -> ${e.target} (${e.relation})`
  );
  return [`Project: ${graph.project}`, ...nodeLines, ...edgeLines].join("\n");
}
```

### 2. `estimateTokenSavings()` — zero-graph guard

```diff
 export function estimateTokenSavings(
   fullGraphTokens: number,
   smartContextTokens: number
 ): { saved: number; percentage: number } {
+  if (fullGraphTokens <= 0) return { saved: 0, percentage: 0 };
   const saved = fullGraphTokens - smartContextTokens;
   const percentage = Math.round((saved / fullGraphTokens) * 100);
   return { saved, percentage };
 }
```

### 3. `buildSmartContext()` — main return path

```diff
-  return withTokenCount(
+  const rawDumpTokens = countTokens(buildRawGraphDump(graph));
+  const responseBody =
     `Knowledge Graph Context (${graph.project})${cacheIndicator}${hasSemanticSearch}\n` +
     `Found ${expandedIds.size} relevant nodes for: "${query}"\n\n` +
     contextText +
     `\n📊 Summary:\n` +
     `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
-    `• Context includes: ${expandedIds.size} relevant nodes (40-60% fewer tokens${cacheHit ? ", 83% more reduction on cache hit" : ""}${!cacheHit && hasEmbeddings(graph.nodes as any) ? ", 20% better selection via semantic search" : ""})\n`
-  );
+    `• Context includes: ${expandedIds.size} relevant nodes\n`;
+  const approxTokens = countTokens(responseBody);
+  const { percentage } = estimateTokenSavings(rawDumpTokens, approxTokens);
+  const notes = [
+    `${percentage}% fewer tokens than a full graph dump`,
+    cacheHit ? "served from cache" : null,
+    !cacheHit && hasEmbeddings(graph.nodes as any) ? "semantic search enabled" : null,
+  ].filter(Boolean);
+  return {
+    text: responseBody + `  (${notes.join(", ")})\n`,
+    approxTokens: countTokens(responseBody + `  (${notes.join(", ")})\n`),
+  };
```

(The final `approxTokens` recomputes over the text *including* the notes line, so the number
reported is the real size of what's actually returned — computing it before appending the notes
would undercount by the length of the notes line itself.)

## Acceptance criteria

- [x] No string literal matching `/\d+%/` appears anywhere in `smart-context.ts` — every
      percentage in the output is produced by `estimateTokenSavings()`.
- [x] `estimateTokenSavings(0, anything)` returns `{ saved: 0, percentage: 0 }`, not `NaN`.
- [x] The cache-hit and semantic-search notes are present/absent exactly as before (same
      conditions), just non-numeric.
- [x] `README.md`'s v2.0 Optimizations/Benchmarks sections no longer present the three
      percentages as current, ongoing fact.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/mcp/src/smart-context.test.ts` doesn't exist yet (that's 029's job), but this spec adds
targeted cases for the pieces it introduces: `packages/core/src/token-count.test.ts` already
covers `countTokens`; add to `estimateTokenSavings` (currently untested, in `smart-context.ts`, no
test file for that module yet — covered minimally here, comprehensively in 029) — zero-baseline
guard, and a normal saved/percentage computation with hand-checked numbers.

## Success Metrics

- Real check: on this repo's own synced graph (132 files, 341 functions), a broad query
  ("graph node edge parser analyzer cluster search context") returned `97% fewer tokens than a
  full graph dump`; a narrow query ("countTokens") returned `100%`. Real, non-hardcoded, and
  moves in the expected direction — fewer matched nodes → smaller context → higher relative
  savings against the same full-dump baseline.

## Related

Depends on: 024 (`countTokens`), 025 (real-session log to sanity-check against). Blocks: 027
(needs a real percentage to quote a before/after against).
