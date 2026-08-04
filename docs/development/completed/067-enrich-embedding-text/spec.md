# 067 — Enrich embedding text

## Status: done

Implemented and tested (10 `embeddings.test.ts` tests — including new coverage for
`buildNodeEmbeddingText`'s field inclusion/omission and calls/used-by lookup, and
`generateGraphEmbeddings`'s `embeddingVersion`-aware re-embedding — plus 1 updated
`smart-context.test.ts` fixture; full workspace suite — 604 core, 119 cli, 15 server, 129 mcp,
39 benchmarks, 906 total — green via `npm test --workspaces`). Real check: ran `npx tsx
benchmarks/retrieval/retrieval-eval.ts --embeddings` before and after against a correctly-resolved
build of the changed code (same `node_modules` symlink gotcha and fix as spec 066 — see the
before/after methodology note in Success Metrics) — see Success Metrics for the numbers.

Spec 068 landed first and created the shared `packages/mcp/src/identifier-tokenize.ts`
(`tokenizeIdentifier`) — this spec imports it rather than creating a second copy, per the spec's
own "whichever lands first owns this file" coordination note.

`generateGraphEmbeddings`'s signature changed from `(nodes: Node[])` to `(graph: Graph)` (all
three real call sites — `handlers.ts`'s `handleSync`, `benchmarks/retrieval/hybrid-eval.ts` —
already had the full `Graph` in scope, so this was a low-friction change) so it can build the
adjacency-label maps once from `graph.edges` and read/write `graph.embeddingVersion`.
`hasEmbeddings` kept its `Node[]`-first signature (its real call sites in `smart-context.ts` pass a
type-filtered *subset* of nodes, not the full graph, to answer "does this candidate set have usable
embeddings") but gained a second `embeddingVersion?: number` parameter that callers pass as
`graph.embeddingVersion` — a version mismatch (including `undefined`, e.g. a pre-067 graph.json)
makes it return `false` unconditionally, before even checking the 50%-embedded threshold.

One open design decision the spec left for implementation: where exactly to place the migration
check. Landed on `hasEmbeddings(nodes, embeddingVersion)` doing the check itself (rather than, say,
a separate `isEmbeddingVersionCurrent(graph)` guard at each call site) — every real call site
already had `graph`/`graph.embeddingVersion` in scope, and centralizing the check inside the one
function whose whole job is "are these embeddings usable" means no call site can forget it.

## Goal

Give nodes' embeddings real semantic content to embed, instead of `"<label> <type>"`.

## Why now

`packages/mcp/src/embeddings.ts:40-50`, `generateNodeEmbedding`:

```ts
const text = `${node.label} ${node.type}`;
```

So `authenticateUser` embeds as `"authenticateUser function"`. The graph already computes `file`,
`group`, `module`, `sourceSet` (`Node` fields, `packages/core/src/types.ts`), and — via
`graph.edges` — what the node calls and what calls it. None of it reaches the embedding text.
A query like *"how do users log in"* has almost no lexical or semantic signal to match against
under the current embedding. This is the highest-ROI accuracy change available: it costs nothing
extra at query time (embeddings are computed once, at sync/first-search time) and reuses data
already sitting in the graph.

## Scope

- `packages/mcp/src/embeddings.ts`: change `generateNodeEmbedding`'s signature from `(node:
  Node)` to `(node: Node, graph: Graph)` (or pass a prebuilt adjacency map — see Design), and
  build the embedding text as:

  ```
  <split label> — <type> in <file basename>
  module: <module> · layer: <group> · sourceSet: <sourceSet>   (only fields that are set)
  calls: <up to 5 outgoing edge target labels>
  used by: <up to 5 incoming edge source labels>
  ```

- **Identifier splitting**: `authenticateUser` → `authenticate User` before embedding —
  MiniLM's tokenizer (the underlying `Xenova/all-MiniLM-L6-v2` model, see `embeddings.ts:17`)
  is trained on natural language, not camelCase identifiers; splitting gives it words it actually
  has good representations for. This is the same identifier-splitting concern spec 068 needs for
  keyword matching — factor it into one shared `tokenizeIdentifier()` utility (candidate location:
  `packages/mcp/src/identifier-tokenize.ts`, imported by both `embeddings.ts` and
  `smart-context.ts`) rather than writing it twice. **Coordinate with spec 068**: whichever of
  066/067/068 lands first should add this utility; the other imports it.
- `generateGraphEmbeddings` (`embeddings.ts:58-88`) needs the full `Graph`, not just `Node[]`, to
  build the adjacency lookups (outgoing/incoming edges per node) once before embedding each node
  — don't rebuild the adjacency map per node (`O(nodes × edges)` — same class of cost spec 070
  fixes elsewhere; build it once here too).
- **Migration — `embeddingVersion`**: embeddings already persisted in existing `graph.json` files
  were built from the old `"<label> <type>"` text. A query embedded against the *new* text is not
  directly comparable to a node embedded against the *old* text (cosine similarity between
  differently-sourced embeddings is meaningless, not just "a bit off"). Add an `embeddingVersion:
  number` field to `Graph` (`packages/core/src/types.ts`), bump it whenever the embedding text
  format changes, and have `hasEmbeddings()`/the sync path check it: if a loaded graph's
  `embeddingVersion` doesn't match the current one, treat those nodes as unembedded (same as if
  `embedding` were unset) and regenerate on next embed pass, rather than silently mixing
  generations. This mirrors the versioned-invalidation shape `files.json` already uses for
  incremental sync (`packages/core/src/file-discovery.ts`) — same pattern, applied to embeddings.

## Out of scope

- Changing the embedding model itself (`Xenova/all-MiniLM-L6-v2`) — a model swap is a much bigger
  change (different dimensionality, different local-download footprint) and unrelated to the
  "embed richer text with the same model" fix here.
- Re-embedding every existing `~/.nodum/*/graph/graph.json` on disk proactively — the
  `embeddingVersion` check means this happens lazily, on the next sync/search that touches a
  stale graph. No migration script needed.

## Design

The adjacency-map-once approach: before the batch embedding loop in `generateGraphEmbeddings`,
build `outgoingByNode: Map<string, string[]>` and `incomingByNode: Map<string, string[]>` from
`graph.edges` (same technique `expandContext` in `smart-context.ts:117-157` already uses), then
look up each node's calls/callers from those maps while building its embedding text — O(edges)
once, not O(nodes × edges).

`embeddingVersion` bump: increment whenever `generateNodeEmbedding`'s text-building logic changes
in a way that would make old and new embeddings incomparable (this spec bumps it once, when
landed; a future embedding-text change bumps it again).

## Acceptance criteria

- [x] `generateNodeEmbedding`'s text includes label (split), type, file basename, and (when
      present) module/group/sourceSet/calls/used-by.
- [x] `generateGraphEmbeddings` builds adjacency maps once, not per node.
- [x] `Graph.embeddingVersion` exists; `hasEmbeddings()` (or the sync path) treats a version
      mismatch as "not embedded" and triggers regeneration rather than mixing generations.
- [x] Re-run `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings` before/after; record
      in Success Metrics.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`embeddings.test.ts` — `generateNodeEmbedding`'s text-building (extract as its own exported
function if not already, for direct unit testing without invoking the real model): includes all
present fields, omits unset ones (a node with no `module` doesn't get a stray "module: undefined"
line), correctly looks up calls/used-by from a small hand-built graph. `embeddingVersion`
mismatch: a graph with an old/missing version is treated as unembedded even if `embedding` arrays
are present.

## Success Metrics

**Before/after methodology note:** same `node_modules` gotcha spec 066 hit — this worktree's
`node_modules` is a symlink into the main checkout's shared `node_modules`, and the hoisted
`@caiquebrito/nodum-*` entries inside it are themselves *relative* symlinks (`../../packages/*`)
that resolve relative to the real, non-symlinked location of that shared directory (the main
checkout), not this worktree. Fixed by replacing the top-level `node_modules` symlink with a real
directory whose entries are individually symlinked from the main checkout, except `@caiquebrito/*`,
which is instead a fresh directory with absolute symlinks pointing directly at this worktree's own
`packages/core`, `packages/mcp`, `packages/cli`, `packages/server` — Node resolves the closer
(worktree-root) `node_modules` first, so the correct entries shadow the wrong hoisted ones without
touching the shared directory. Verified via `node -e "console.log(require.resolve('@caiquebrito/
nodum-mcp/dist/embeddings.js'))"` (run from `benchmarks/`) resolving into this worktree both before
trusting "before" and again before trusting "after". "Before" was captured with `git stash`
(reverting all 7 changed files to `develop`'s original content, rebuilding, running the harness)
and "after" by `git stash pop` + rebuild + rerun — same process, same fixture graphs, same
embedding model, only the embedding text differs.

**Keyword-only ranker (unaffected control — this spec doesn't touch the keyword path):** identical
before and after — `recall@5=0.962 recall@10=0.962 precision@10=0.443 mrr=0.865 ndcg@10=0.893`.
Confirms the change is correctly scoped to embedding generation only.

**Hybrid ranker (keyword + semantic fusion) — before (old `"<label> <type>"` embedding text):**
`recall@5=0.974 recall@10=1.000 precision@10=0.115 mrr=0.962 ndcg@10=0.971`
(this is spec 066's post-fix number, unchanged — expected, since spec 066 is already on `develop`
and this spec's "before" is `develop` HEAD prior to any spec 067 change).

**Hybrid ranker — after (enriched embedding text: split label, type, file basename, module/layer/
sourceSet, calls, used-by):**
`recall@5=0.974 recall@10=1.000 precision@10=0.115 mrr=0.942 ndcg@10=0.949`

Recall and precision are unchanged — both were already at their ceiling for this 26-query golden
set (every query's correct node already appears somewhere in the top 10 under the old text, and
precision@10 is capped by design regardless of ranking quality, per spec 066's note on the same
metric). The measurable effect is a small **regression** in rank quality on this particular golden
set: MRR moved `0.962 → 0.942` and nDCG@10 moved `0.971 → 0.949`. Per-query, the entire delta comes
from three queries: `ts-14` and `ts-16` each dropped from `mrr=1.00` (correct node ranked #1) to
`mrr=0.50` (ranked #2), while `py-10` improved from `mrr=0.50` to `mrr=1.00` (ranked #1) — a net of
two down, one up, on a 26-query set. This is a real, reproduced-twice result, not noise from a
single run.

This does not falsify the design rationale (richer text should give MiniLM more signal to work
with) — a 26-query, 2-fixture golden set is too small to be a reliable signal at this margin (three
queries flipping is a ±11% swing in how many queries have a perfect MRR), and the two regressed
queries (`ts-14`, `ts-16`) are plausible cases where adding module/layer/calls/used-by context
*dilutes* an otherwise-clean cosine match for a query whose golden target's label alone was already
a strong lexical/semantic anchor, while `py-10` — the specific zero-lexical-overlap case both this
spec and spec 066 target — is exactly where the added context is expected to help most (its target
previously had almost nothing but a bare label to match against). Whether the richer text is a net
win requires a larger, more representative golden set to measure reliably; that's future work, not
a blocker for landing a change that is architecturally correct (avoids `embeddingVersion` mixing,
builds adjacency once, reuses the shared tokenizer) and is not a regression on the CI-gated
keyword-only floor.

## Related

Depends on: spec 066 (fusion has to work for richer embeddings to matter). Shares the
identifier-tokenization utility with spec 068 — coordinate on the shared file.
