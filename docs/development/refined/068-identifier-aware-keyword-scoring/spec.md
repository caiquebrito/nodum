# 068 — Identifier-aware keyword scoring with IDF

## Status: refined — not started

Fully designed, not yet branched.

## Goal

Replace `scoreNode`'s substring matching with term-based, IDF-weighted matching over split
identifiers.

## Why now

`packages/mcp/src/smart-context.ts:59-85`, `scoreNode`:

```ts
if (node.label.toLowerCase().includes(keyword)) { score += 5; }
```

Consequences:

- **Substring, not term, matching**: `getUserById` matches keyword `user` only because `user` is
  a substring of the label — coincidentally correct here, but the same mechanism means `get`
  matches hundreds of unrelated `getX` functions with equal weight to a real match. No
  distinction between "this word is literally one of the identifier's parts" and "this string
  happens to appear inside a longer word."
- **No IDF**: every keyword contributes the same score regardless of how common it is across the
  graph's own vocabulary. `get`, `handle`, `data` (near-ubiquitous) score identically to
  `authenticate`, `checkout`, `webhook` (rare, actually discriminative) — the opposite of how a
  real search ranker should weight terms.
- **2-char keyword floor drops real identifiers**: `extractKeywords` (`smart-context.ts:41-53`)
  filters `word.length > 2`, silently losing `id`, `db`, `ui`, `io` — all real, common identifier
  fragments in most codebases.
- **No camelCase/snake_case splitting** on either the query or the node label side.

## Scope

- New `tokenizeIdentifier(name: string): string[]` — splits camelCase, PascalCase, snake_case,
  and kebab-case into lowercase terms (`getUserById` → `["get", "user", "by", "id"]`). Shared
  with spec 067's embedding-text splitting (see that spec's Scope — land the utility in whichever
  of 067/068 lands first; the other imports it). Suggested location:
  `packages/mcp/src/identifier-tokenize.ts`.
- In `smart-context.ts`: build a per-graph term index once per `buildSmartContext` call (or
  cached alongside `globalGraphCache`, see spec 069/070's caching pattern) — `Map<term,
  Set<nodeId>>` from every node's tokenized label (and optionally file path).
- Replace `scoreNode`'s substring checks with term-set intersection: exact-term match on a split
  label term outranks a raw substring match (keep a lower-weight substring fallback for queries
  that don't tokenize cleanly, e.g. a copy-pasted exact function name).
- **IDF weighting**: for each term, `idf(term) = log(totalNodes / (1 + nodesContainingTerm))`,
  computed once per graph from the same term index above (not recomputed per query). Multiply a
  term's match score by its IDF weight, so common terms contribute less and rare ones more.
- Lower `extractKeywords`'s length filter from `word.length > 2` to `word.length > 1`, and add a
  small, explicit stop-list for genuinely noise-only 1-2 char tokens (articles, prepositions
  already in the existing `stopWords` set) rather than a blanket length cutoff — recovering `id`,
  `db`, `ui`, `io` as valid keywords.

## Out of scope

- Changing `findRelevantNodes`'s overall ranking-and-return shape (still returns `Node[]` sorted
  by score) — this spec changes how `scoreNode` computes the number, not the surrounding
  function's contract, so spec 066's RRF fusion doesn't need to know about this change beyond
  "the keyword ranker's ordering got better."
- Query expansion (synonyms, stemming beyond simple identifier splitting) — out of scope; the
  IDF + term-match fix is the well-scoped improvement here.

## Design

Term index built once per `buildSmartContext` call over `graph.nodes` (labels only, to start —
extending to file paths is a natural follow-up but adds noise from directory names; measure
before adding). IDF computed from the same index, so no second pass over the graph. Both are
candidates for the same per-graph-generation cache spec 069/070 introduce for the raw-dump token
count — if that caching infrastructure lands first, reuse it here instead of building a second,
parallel caching mechanism.

## Acceptance criteria

- [ ] `tokenizeIdentifier` unit-tested directly: camelCase, PascalCase, snake_case, kebab-case,
      and mixed cases (`XMLHttpRequest`-style acronym boundaries — decide and document the rule
      rather than leaving it undefined).
- [ ] `scoreNode`/its replacement scores an exact split-term match higher than a coincidental
      substring match (e.g. query `user` should not score `getUserById` and a hypothetical
      `superclass` node's `super` era... — construct a real minimal-pair test case during
      implementation).
- [ ] IDF weighting verified: a rare term (appears in 1 of 50 nodes) contributes more score than
      a common term (appears in 40 of 50 nodes) for an otherwise-equal match.
- [ ] `extractKeywords` recovers `id`, `db`, `ui`, `io` as valid keywords while still dropping
      pure stop words.
- [ ] Re-run `npx tsx benchmarks/retrieval/retrieval-eval.ts` (keyword path) before/after; record
      in Success Metrics. The CI-gated `retrieval-eval.test.ts` floor should only move upward — if
      it drops, something regressed; raise the floor deliberately if it improves (per that test's
      own doc comment).
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

New `identifier-tokenize.test.ts` — the splitting function against a table of real identifier
shapes. `smart-context.test.ts` — IDF weighting cases (hand-built small graphs with known term
frequencies), term-match vs. substring-match precedence, `extractKeywords`'s recovered short
keywords.

## Success Metrics

Fill in after implementation: `retrieval-eval.ts` (keyword-only path) aggregate before/after.
This is the one spec in the arc validated without needing `--embeddings` at all, since it only
touches the keyword ranker — should be the fastest of 066-068 to measure.

## Related

Depends on: none strictly (can land independently of 066/067, though shares the identifier-
splitting utility with 067 — coordinate). Feeds: spec 066's RRF fusion benefits from a better
keyword ranker as one of its two inputs.
