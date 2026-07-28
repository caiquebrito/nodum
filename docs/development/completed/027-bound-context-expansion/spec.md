# 027 — Bound context expansion

## Status: done

Implemented and tested (5 new cases across `smart-context.test.ts` and `handlers.test.ts`, plus 1
more in `embeddings.test.ts` for a bug found along the way; full workspace suite — 196 core, 95
cli, 24 mcp, 315 total — green). Real check used `git stash` to measure actual pre-fix behavior
rather than estimate it — see Success Metrics for the exact numbers: 5793 → 283 `approxTokens`
(20x) on a deliberately hub-heavy fixture.

## Goal

Cap `expandContext()`'s 1-hop neighbor expansion and the two untruncated member-node lists in
`handlers.ts`. This is the actual bug fix v2.2.0's measurement work (024–026) exists to make
provable: `maxNodes` has always limited how many *seed* nodes get selected, never how many
neighbors each seed can pull in, so a query that matches one heavily-imported hub file can blow
the returned context open to an arbitrary size.

## Why now

024–026 had to land first so this spec's fix could be measured rather than asserted — the
acceptance criterion below is a quoted before/after `approxTokens` number, which didn't exist
before this batch. This is also the last of the three specs the v2.2.0 plan named individually
(`smart-context.ts`'s `expandContext`, `handleAnalyzeFile`, `handleExpandCluster`); 028 and 029
are process/coverage work, not further bug fixes.

## Scope

- `packages/mcp/src/smart-context.ts` — `expandContext()`:
  - **Correctness**: cap neighbors added per seed node (`MAX_NEIGHBORS_PER_SEED = 10`, matching
    the existing per-node caps `buildNodeContext` already uses for its own outgoing/incoming
    lists) and add a hard ceiling on the total expanded set (`MAX_EXPANDED_NODES = 150`)
    regardless of seed count or any single node's fan-out.
  - **Performance**: replace the current O(seeds × edges) double scan (two full passes over
    `edges` per seed node) with a one-time O(edges) adjacency index (`Map<sourceId, targetId[]>`
    / `Map<targetId, sourceId[]>`) built once per call, then looked up per seed. Named in the
    v2.2.0 plan alongside the correctness fix since both live in the same function and the
    rewrite needed to build the adjacency index anyway.
- `packages/mcp/src/handlers.ts`:
  - `handleAnalyzeFile`: `nodesInFile` (the file's member list) is currently unbounded — a
    400-function file lists all 400. Cap and append an `... and N more` suffix, matching the
    style `buildNodeContext`'s own dependency lists already use.
  - `handleExpandCluster`: `memberNodes` and `cluster.externalDeps` are both currently unbounded.
    Same cap-and-suffix treatment. (`internalEdges` in the same function is already `.slice(0,
    10)` — untouched.)
- Single shared cap constant for the two handler lists (`MAX_LISTED_MEMBERS = 20`) — distinct
  from `expandContext`'s constants since it bounds a different thing (members shown in a single
  file/cluster listing, not a 1-hop graph expansion).

## Out of scope

- Making any of these caps configurable via `.nodumrc.json` — v2.5's adaptive-budgeting job
  (accepting a token budget as an MCP parameter), not a fixed-constant tuning knob here.
- Changing `findRelevantNodes()`'s seed selection (`maxNodes`) itself — this spec only bounds
  what happens *after* seeds are chosen.
- `handleGetDeps`'s existing `items.slice(0, 5)` truncation — already capped, not part of this
  spec's named list.

## Design

### 1. `packages/mcp/src/smart-context.ts` — `expandContext()`

```ts
const MAX_NEIGHBORS_PER_SEED = 10; // per direction, per seed node
const MAX_EXPANDED_NODES = 150;    // hard ceiling regardless of seed count or fan-out

function expandContext(
  nodes: Graph["nodes"],
  edges: Graph["edges"],
  nodeMap: Map<string, Graph["nodes"][0]>
): Set<string> {
  // Adjacency built once (O(E)) instead of re-scanning all edges per seed (O(seeds × E)).
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (nodeMap.has(edge.target)) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source)!.push(edge.target);
    }
    if (nodeMap.has(edge.source)) {
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      incoming.get(edge.target)!.push(edge.source);
    }
  }

  const relevant = new Set<string>();

  for (const node of nodes) {
    if (relevant.size >= MAX_EXPANDED_NODES) break;
    relevant.add(node.id);

    for (const target of (outgoing.get(node.id) ?? []).slice(0, MAX_NEIGHBORS_PER_SEED)) {
      if (relevant.size >= MAX_EXPANDED_NODES) break;
      relevant.add(target);
    }
    for (const source of (incoming.get(node.id) ?? []).slice(0, MAX_NEIGHBORS_PER_SEED)) {
      if (relevant.size >= MAX_EXPANDED_NODES) break;
      relevant.add(source);
    }
  }

  return relevant;
}
```

### 2. `packages/mcp/src/handlers.ts` — `handleAnalyzeFile`

```diff
+const MAX_LISTED_MEMBERS = 20;
+
 ...
+    const listedMembers = nodesInFile.filter((n) => n.type !== "file");
     const summary =
       `📄 File: ${filePath}\n\n` +
       `📊 Contents:\n` +
-      nodesInFile
-        .filter((n) => n.type !== "file")
-        .map((n) => `  • ${n.label} (${n.type})`)
-        .join("\n") +
+      listedMembers
+        .slice(0, MAX_LISTED_MEMBERS)
+        .map((n) => `  • ${n.label} (${n.type})`)
+        .join("\n") +
+      (listedMembers.length > MAX_LISTED_MEMBERS
+        ? `\n  ... and ${listedMembers.length - MAX_LISTED_MEMBERS} more`
+        : "") +
       `\n\n` +
```

### 3. `packages/mcp/src/handlers.ts` — `handleExpandCluster`

Same treatment for `memberNodes` and `cluster.externalDeps`, each capped at
`MAX_LISTED_MEMBERS` with an `... and N more` suffix when truncated.

## Acceptance criteria

- [x] `expandContext()` never returns more than `MAX_EXPANDED_NODES` ids, regardless of how many
      dependents a single seed node has.
- [x] `expandContext()` builds its adjacency maps once per call (verified by test — an edge list
      is scanned a bounded number of times, not once per seed).
- [x] `handleAnalyzeFile` and `handleExpandCluster` both cap their member lists at
      `MAX_LISTED_MEMBERS` with an `... and N more` suffix when truncated, and no suffix when not.
- [x] **Quoted before/after `approxTokens` on a deliberately hub-heavy fixture** — the actual
      acceptance bar the v2.2.0 plan named for this spec specifically. See Success Metrics.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/mcp/src/smart-context.test.ts` (extend) — a synthetic graph with one hub node and 300
edges into it; confirm `buildSmartContext()`'s resulting node count (and therefore `approxTokens`)
stays bounded rather than growing with the dependent count. `packages/mcp/src/handlers.test.ts`
(extend) — `handleAnalyzeFile` on a file with more than `MAX_LISTED_MEMBERS` members shows the
truncation suffix with the correct remainder count; `handleExpandCluster` likewise for both
`memberNodes` and `externalDeps`.

## Success Metrics

- Real check: hand-authored a `graph.json` fixture — one `hub.ts` file node (plus one unrelated
  function node, to avoid the `hasEmbeddings()` bug below) with 300 separate file nodes each
  importing it (300 `imports` edges into the hub), loaded directly by the compiled MCP server at
  `~/.nodum/hub-fixture-027/`, queried via `search_graph` for "hub". Compared the actual
  pre-fix behavior against the fix using `git stash` to rebuild from the unmodified source, not a
  hypothetical estimate:
  - **Before**: 302 relevant nodes found (literally the entire 302-node graph — this fixture's
    "unbounded" case was, in practice, completely unbounded), **5793 `approxTokens`**, response
    reporting only 26% savings (there was almost nothing left to save against).
  - **After**: 12 relevant nodes found, **283 `approxTokens`** — a 20x reduction — response
    correctly reporting 97% savings.

## Bugs found during real implementation

- **`hasEmbeddings()` is vacuously true for an all-file-node graph.** `packages/mcp/src/
  embeddings.ts`'s check is `withEmbeddings.length >= nonFileNodes.length * 0.5`; with zero
  non-file nodes, that's `0 >= 0`, always true — so a graph with no functions/classes extracted
  yet (or, as surfaced here, a hand-authored fixture using only file nodes) is treated as having
  semantic search available when it plainly doesn't. Caught because the original hub fixture (all
  `type: "file"` nodes) tripped it, sending the test down the real embeddings pipeline instead of
  the keyword path and producing "No nodes found" instead of a match. Fixed with the same
  zero-baseline-guard pattern as 026's `estimateTokenSavings()` fix: return `false` when there are
  no non-file nodes to check, rather than reaching a vacuous `0 >= 0`. Also fixed the fixture
  itself to include one real non-file node, matching what an actual synced project always has.

## Related

Depends on: 024 (`approxTokens` to quote), 025 (log to sanity-check against), 026 (real
percentage the fix should measurably improve). This is the last bug-fix spec in the v2.2.0
batch — 028/029 are process and coverage work.
