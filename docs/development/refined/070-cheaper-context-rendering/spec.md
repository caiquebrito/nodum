# 070 — Cheaper context rendering

## Status: refined — not started

Fully designed, not yet branched.

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

- [ ] `buildContextSections` no longer independently scans `graph.edges` per node — reuses
      `expandContext`'s maps. Verified: byte-identical output on the existing
      `smart-context.test.ts` fixtures before/after this specific change.
- [ ] `search_graph` applies a default `token_budget` when the caller doesn't specify one;
      explicit `0`/`null` still means unbounded.
- [ ] Decoration trim decision is backed by a real comparison (IR metrics and/or a documented
      spot check), not assumed — the spec's Success Metrics section states which was used and
      what it found.
- [ ] Footer compression: first call in a cached session gets the full footer, subsequent calls
      (same project, cache-eligible) get the short form — verified via `ConversationCache`-backed
      test.
- [ ] `benchmarks/context-size.test.ts` ceilings still hold, and should tighten — lower
      `NORMAL_QUERY_CEILING`/`HUB_QUERY_CEILING` to whatever this spec actually achieves (per that
      test's own doc comment: raise/lower ceilings deliberately, with the reason stated).
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

`smart-context.test.ts` — adjacency-reuse: existing fixtures produce identical output.
Default-budget: a `search_graph`-shaped call with no `token_budget` still triggers
`fillSectionsToBudget`; an explicit `token_budget: 0` bypasses it. Footer compression: two
sequential calls against the same cached session produce a full then short footer;
different sessions/projects each get a full footer.

## Success Metrics

Fill in after implementation: `handleSearch` timing before/after (adjacency reuse), token count
of a representative response before/after (default budget + decoration + footer changes,
measured together or separately depending on how they're sequenced), and the decoration-trim
comparison's actual finding (kept vs. trimmed, with the evidence).

## Related

Depends on: none strictly, though naturally follows 066-068 (better to measure token cost against
a ranker that's already been fixed, not the pre-fix one). Related to spec 069 (shared token-cost
theme).
