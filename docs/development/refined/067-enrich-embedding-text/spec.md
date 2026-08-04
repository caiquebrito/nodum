# 067 — Enrich embedding text

## Status: refined — not started

Fully designed, not yet branched. Depends on spec 066 landing first (fusion has to actually use
the semantic signal before improving that signal's quality is worth measuring).

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

- [ ] `generateNodeEmbedding`'s text includes label (split), type, file basename, and (when
      present) module/group/sourceSet/calls/used-by.
- [ ] `generateGraphEmbeddings` builds adjacency maps once, not per node.
- [ ] `Graph.embeddingVersion` exists; `hasEmbeddings()` (or the sync path) treats a version
      mismatch as "not embedded" and triggers regeneration rather than mixing generations.
- [ ] Re-run `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings` before/after; record
      in Success Metrics.
- [ ] `npm run build && npm test --workspaces` green.

## Test plan

`embeddings.test.ts` — `generateNodeEmbedding`'s text-building (extract as its own exported
function if not already, for direct unit testing without invoking the real model): includes all
present fields, omits unset ones (a node with no `module` doesn't get a stray "module: undefined"
line), correctly looks up calls/used-by from a small hand-built graph. `embeddingVersion`
mismatch: a graph with an old/missing version is treated as unembedded even if `embedding` arrays
are present.

## Success Metrics

Fill in after implementation: `retrieval-eval.ts --embeddings` aggregate before/after, same
metric set as spec 066, ideally run together as one before/after pair since both change the
semantic path (066 fixes fusion, 067 improves what's being fused).

## Related

Depends on: spec 066 (fusion has to work for richer embeddings to matter). Shares the
identifier-tokenization utility with spec 068 — coordinate on the shared file.
