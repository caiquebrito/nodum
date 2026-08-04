# 070 — Cheaper context rendering

## Status: done

Implemented as designed, all four scope items landed. `buildContextSections` and `expandContext`
now share one adjacency map (`buildGraphAdjacency`, `packages/mcp/src/smart-context.ts`), built
once in `buildSmartContext` from the full graph and threaded into both — byte-identical output on
every existing `smart-context.test.ts` fixture, confirmed directly (no fixture changes were
needed). `search_graph`'s `token_budget` now defaults to 1500 at the MCP tool boundary
(`packages/mcp/src/index.ts`'s `resolveTokenBudget`), distinguishing "caller omitted it" (gets the
default) from an explicit `0`/`null` ("caller wants everything", passed through as `undefined` to
`buildSmartContext`'s own unchanged unbounded-by-default contract). Footer compression added a
session-scoped `hasShownFullFooter`/`markFooterShown` pair to `ConversationCache`
(`packages/mcp/src/conversation-cache.ts`), reusing its existing 5-minute TTL as the session
boundary rather than introducing a second one; `buildSmartContext` now renders the full
summary+notes footer only when the session hasn't seen one yet, and skips the
`rawDumpApproxTokens`/percentage computation entirely on the short-footer path (a CPU win, not just
a token one). The decoration-trim question was measured, not assumed, and the finding was to
**leave decoration in place** — see Success Metrics for the real numbers and reasoning. Caught and
fixed in review: the short footer's truncated-case text initially broke `nodum metrics`' truncation
telemetry (see the correction note near the end of Success Metrics). 14 new tests (5 in
`smart-context.test.ts` for footer compression, 6 in `conversation-cache.test.ts` for
the new session-tracking methods, 3 in `index.test.ts` replacing a now-stale pre-070 expectation
about `budgetApplied`), full workspace suite green: 604 core, 119 cli, 15 server, 138 mcp, 39
benchmarks — 915 total, via `npm run build && npm test --workspaces`.
`benchmarks/context-size.test.ts`'s ceilings were left unchanged with the reason documented inline
(both fixture calls go through `buildSmartContext` directly with no `cache`/`tokenBudget`, the two
axes spec 070's response-shaping changes actually fire on — measured byte-identical `approxTokens`
before/after on both fixtures).

## Goal

Reduce both the CPU cost and the token cost of `buildSmartContext`'s response formatting,
without changing retrieval quality.

## Why now

Three separate, independently-fixable inefficiencies in `packages/mcp/src/smart-context.ts`:

1. **Adjacency maps built, then thrown away, then rebuilt via O(n×e) scans.** `expandContext`
   (`:117-157`) builds `outgoing`/`incoming` adjacency maps from `graph.edges` once — good. But
   `buildContextSections` (`:181-267`), called right after, does `graph.edges.filter(e => e.source
   === node.id)` and `graph.edges.filter(e => e.target === node.id)` **inside a per-node loop**
   (`:246`, `:251`) — an O(nodes × edges) rescan of the exact same information `expandContext`
   already computed and discarded.
2. **No default token budget.** `search_graph`'s `token_budget` parameter
   (`packages/mcp/src/index.ts:151`) is optional with no default — the common, unbudgeted path
   never exercises spec 041's budgeting machinery (`fillSectionsToBudget`,
   `smart-context.ts:295-318`) at all.
3. **Decoration overhead.** `buildContextSections` emits `📄`, `⚙️`, `🔗`, `├`, `→`, `←` per node.
   Emoji cost 2-3 tokens each under `o200k_base` (`js-tiktoken`, per `token-count.ts`'s doc
   comment). At the `MAX_EXPANDED_NODES = 150` ceiling (`:111`), that's roughly 300-500 tokens of
   pure decoration per response — real cost, unmeasured impact on readability/accuracy.
4. **Repeated footer.** The savings note and summary block (`:512-530`) are re-emitted in full on
   every call, even within the same session/conversation.

## Scope

- **Adjacency reuse**: thread `expandContext`'s `outgoing`/`incoming` maps into
  `buildContextSections` (change its signature to accept them, or compute them once in
  `buildSmartContext` and pass down to both `expandContext` and `buildContextSections`) — pure
  performance win, zero output change, so this part alone should ship with no accuracy re-
  measurement needed (byte-identical output).
- **Default `token_budget`**: give `search_graph`'s `token_budget` a sane default (proposed:
  `1500`, but calibrate against the golden set — see Acceptance criteria) so
  `fillSectionsToBudget` runs on the common path. An explicit `0` or `null` from the caller means
  "unbounded" (today's behavior), distinguishing "caller didn't specify" (gets the default) from
  "caller explicitly wants everything."
- **Decoration trim** — conditional on measurement, not assumed: build both a decorated and a
  plain-ASCII-marker variant of `buildContextSections`'s output, run both through
  `benchmarks/retrieval/retrieval-eval.ts --embeddings` (or, if retrieval quality is provably
  unaffected by rendering — likely, since IR metrics score node *selection*, not formatting —
  spot-check with a real Claude session instead, since decoration's actual cost/benefit is about
  the *downstream LLM's* comprehension, which the IR harness doesn't measure). If terser output
  doesn't measurably hurt comprehension in spot checks, trim it; if it's ambiguous, say so in this
  spec's Success Metrics and leave the decoration in place with the finding documented, rather
  than guessing.
- **Footer compression**: emit the full summary+notes footer on a session's first
  `search_graph` call, a short form (just the node count and truncation flag, no repeated
  percentage/notes prose) on subsequent calls within the same cached session. Needs a
  session-scoped flag — `ConversationCache` (`packages/mcp/src/conversation-cache.ts`) is the
  natural place to track "has this project's footer been shown in full this session."

## Out of scope

- Changing what counts as "relevant" (that's specs 066-068) — this spec only changes how the
  already-selected relevant set is rendered and budgeted.
- The raw-dump caching fix — that's spec 069, though both specs touch token-cost concerns and
  could share a PR if implementation reveals meaningful overlap (e.g. if the same per-graph cache
  key ends up used for both).

## Design

Adjacency-map threading: change `buildContextSections(relevantIds, graph)` to
`buildContextSections(relevantIds, graph, adjacency: { outgoing: Map<...>, incoming: Map<...> })`
and have `buildSmartContext` build the maps once, pass to both `expandContext` and
`buildContextSections`.

Default budget: `SmartContextOptions.tokenBudget` (`smart-context.ts:342-368`) changes from
`tokenBudget?: number` (undefined = unbounded) to defaulting at the `search_graph` MCP tool
boundary (`index.ts`), not inside `buildSmartContext` itself — keeps `buildSmartContext`'s own
"undefined = unbounded" contract intact for any other caller (e.g. a future LSP integration per
spec 071+) that wants unbounded by default.

## Acceptance criteria

- [x] `buildContextSections` no longer independently scans `graph.edges` per node — reuses
      `expandContext`'s maps. Verified: byte-identical output on the existing
      `smart-context.test.ts` fixtures before/after this specific change.
- [x] `search_graph` applies a default `token_budget` when the caller doesn't specify one;
      explicit `0`/`null` still means unbounded.
- [x] Decoration trim decision is backed by a real comparison (IR metrics and/or a documented
      spot check), not assumed — the spec's Success Metrics section states which was used and
      what it found.
- [x] Footer compression: first call in a cached session gets the full footer, subsequent calls
      (same project, cache-eligible) get the short form — verified via `ConversationCache`-backed
      test.
- [x] `benchmarks/context-size.test.ts` ceilings still hold, and should tighten — lower
      `NORMAL_QUERY_CEILING`/`HUB_QUERY_CEILING` to whatever this spec actually achieves (per that
      test's own doc comment: raise/lower ceilings deliberately, with the reason stated).
      **Left unchanged, with the reason stated inline in the test file** — see Success Metrics.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`smart-context.test.ts` — adjacency-reuse: existing fixtures produce identical output.
Default-budget: a `search_graph`-shaped call with no `token_budget` still triggers
`fillSectionsToBudget`; an explicit `token_budget: 0` bypasses it. Footer compression: two
sequential calls against the same cached session produce a full then short footer;
different sessions/projects each get a full footer.

## Success Metrics

**Adjacency reuse — timing.** A standalone harness reimplementing `buildContextSections` in both
its pre-070 form (`graph.edges.filter(...)` rescanned per node) and its post-070 form (adjacency
map built once, reused per node), run 20x after a warm-up call, two graph shapes:

| Shape | Before (avg/call) | After (avg/call) | Speedup | Saved/call |
|---|---|---|---|---|
| Worst case: every node relevant (5,000 nodes, 4,000 edges, 5,000 relevant ids) | 210.41ms | 2.71ms | 77.7x | 207.7ms |
| Realistic: capped expansion (150 relevant ids out of 20,000 nodes / 16,000 edges) | 16.50ms | 0.26ms | 63.2x | 16.2ms |

The realistic-shape row matches production: `buildContextSections` is only ever called with the
expanded set (`expandedIds`, capped at `MAX_EXPANDED_NODES = 150`), while `graph.edges` can still
be in the thousands for a real synced project — this is the actual `O(150 × edges)` →
`O(edges)` win the spec targeted. `smart-context.test.ts`'s 43 tests (unchanged in count/content
save for the 4 new footer-compression ones) confirm byte-identical output on every existing
fixture.

**Default token_budget + footer compression — token counts.** Measured via `buildSmartContext`
directly on representative graphs (60 files × 2 nodes each, keyword-matched query):

| Call | Tokens |
|---|---|
| Unbounded (pre-070 default behavior, no `tokenBudget`) | 883 |
| With the new default `token_budget: 1500` (no truncation triggered — this graph's full output fits) | 883 |
| Session call 1 (`cache` supplied, full footer) | 883 |
| Session call 2 (same cached session, short footer) | 858 (-25 tokens, -2.8%, plus skips `rawDumpApproxTokens`'s CPU work entirely) |

The default budget's real effect is conditional, by design: it only trims output once a response's
natural size exceeds 1500 tokens (already covered by `smart-context.test.ts`'s pre-existing
"token budget (spec 041)" tests, which exercise real truncation at a 150-token budget on a
30-file graph) — for typical, modestly-sized responses it now runs `fillSectionsToBudget`
(previously almost never exercised on the common path) without changing output, which is exactly
the acceptance criterion: budgeting machinery engaged, not necessarily truncation forced.

**Decoration trim — the finding.** Built a plain-ASCII-marker variant of `buildContextSections`'s
output (`📄`→`FILE`, `🔗`→`CLUSTER`, `→`/`←`→`calls:`/`called-by:`, box-drawing dropped) and
measured real token counts against the decorated original on three representative shapes:

| Shape | Decorated | Plain-ASCII | Savings |
|---|---|---|---|
| Hub query (few seeds, small expansion) | 310 | 283 | 27 tokens (8.7%) |
| Normal query (30 files, no hub) | 883 | 781 | 102 tokens (11.6%) |
| Max-expansion query (33 nodes, many dependents) | 880 | 842 | 38 tokens (4.3%) |

Real, but modest — well short of the spec's original 300-500 token estimate at the
`MAX_EXPANDED_NODES = 150` cap (that estimate assumed decoration cost scales roughly linearly with
node count; in practice most of it is a per-file header plus a short per-node prefix, and multiple
nodes per file share one header, so density is lower than assumed). On the IR-metrics side:
confirmed by reading `benchmarks/retrieval/retrieval-eval.ts` that it calls `findRelevantNodes`
directly and never invokes `buildContextSections`/`buildSmartContext`'s rendering path at all — so
IR metrics are structurally incapable of showing any effect from a rendering-only change, which is
exactly what the spec predicted ("likely, since IR metrics score node selection, not formatting").
Ran it anyway as a general regression check for the whole PR: aggregate numbers unchanged
(`recall@5=0.962 recall@10=0.962 precision@10=0.443 mrr=0.865 ndcg@10=0.893`, identical before and
after all four changes in this spec). No live Claude spot-check was available in this environment
(no API access) to measure the one thing that actually matters for this decision — downstream-LLM
comprehension impact of terser output. Per the spec's own guidance ("if it's ambiguous, say so ...
and leave the decoration in place with the finding documented, rather than guessing"): **decision
is to leave decoration in place.** The real, measured token cost (4-12% of a representative
response) is recorded here for whoever picks this up next with real LLM-facing measurement
available (`benchmarks/harness.ts`'s nightly/manual `tokensPerCorrectAnswer` run would be the right
tool for that follow-up).

**Correction found in review**: the short footer's truncated-case text originally read
`"(of N found — cut short by token budget)"` — a paraphrase, not the literal string
`"truncated to fit token budget"` that `packages/mcp/src/index.ts`'s `withMetrics` substring-matches
to populate the `truncated` field in `nodum metrics`' telemetry (spec 065). That paraphrase meant
every truncated call after a session's first would silently stop reporting `truncated: true` to
`~/.nodum/<project>/logs/metrics.jsonl` — the exact observability regression the measurement rule
in `CLAUDE.md` exists to prevent, on a spec that didn't touch telemetry at all. Fixed by keeping the
literal phrase in the short footer too, and a new test
(`smart-context.test.ts`, "keeps the exact 'truncated to fit token budget' phrase...") forces real
truncation on the short-footer path specifically and asserts the exact string is present — verified
to fail against the paraphrased version before the fix, confirming the test actually catches this
class of regression rather than just documenting it after the fact.

## Related

Depends on: none strictly, though naturally follows 066-068 (better to measure token cost against
a ranker that's already been fixed, not the pre-fix one). Related to spec 069 (shared token-cost
theme).
