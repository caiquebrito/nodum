# 019 — MCP `find_similar_code` (detect duplicate patterns)

## Status: done

Implemented, tested (169 core tests total including new `analyzer/similar-code.test.ts`; 89 CLI
tests total including new `commands/similar-code.test.ts`; 13 MCP tests total including extended
`handlers.test.ts` coverage for `handleFindSimilarCode`), and verified end-to-end against real
files on disk:
- Rebuilt spec 015's renamed-but-structurally-identical TS fixture pair (`validateUserInput`/
  `validateOrderInput`), plus an unrelated small `unrelatedHelper`: `nodum similar-code`
  correctly reported `validateOrderInput` as the sole match for `validateUserInput`, and
  correctly reported no matches for `unrelatedHelper`.
- `benchmarks/projects/sample-next-app`, querying `authMiddleware` (known from spec 015's own
  verification to have no duplicates in this fixture): correctly reported a clean "no similar
  code" result.

## Goal

Given a specific node, show what else in the project is structurally near-identical to it.
Ships as a pure `packages/core` function, a new `find_similar_code` MCP tool, and a companion
`nodum similar-code <projectPath> <nodeId> [--json]` CLI command.

## Why now

Fourth of the five MCP-enhancement specs, depending on `015-code-duplication-detection`, which
is shipped. `detectDuplicates(graph)` already exists and does the real work (structural-hash
grouping); this spec's job is a different **query shape** on the same data, not new detection
logic.

**Design call, not a feasibility gap**: `detectDuplicates` returns *every* duplicate group in
the project at once — a global report. "Find similar code" is inherently about a specific piece
of code a caller already has in view (a model looking at one function and asking "what else
looks like this"), not a request for the whole project's duplication report, which could be
large and mostly irrelevant to what's actually being asked. This spec is a thin, node-scoped
lookup on top of `detectDuplicates` — reused directly, not re-implemented — same compositional
posture as specs 017/018.

## Scope

- `packages/core/src/analyzer/similar-code.ts`: `findSimilarCode(graph, nodeId)` — runs
  `detectDuplicates(graph)`, finds the group (if any) containing `nodeId`, and returns every
  *other* member of that group. A node with no `duplicateHash` (too small to be scored, per spec
  015's 20-token threshold) or a nonexistent node ID both naturally produce an empty match list
  — no special-casing needed, since neither will appear in any group `detectDuplicates` returns.
- `find_similar_code` MCP tool (new `handleFindSimilarCode` in `handlers.ts`, registered in
  `index.ts`) — `project_name`, `node_id`.
- `nodum similar-code <projectPath> <nodeId> [--json]` CLI command — same two-positional-argument
  shape as spec 016's `nodum trace-impact`, used as the real end-to-end verification vehicle.

## Out of scope

- **New similarity detection logic.** Structural-hash matching is entirely spec 015's job; this
  spec only changes how the result is queried (by node, not globally).
- **Fuzzy/approximate similarity** (e.g. "80% similar"). `detectDuplicates`'s hash-equality
  matching is exact-or-nothing (Type-2-style, per spec 015's own scope); this spec inherits that
  boundary rather than adding a new approximate-matching layer.
- **Ranking matches by "how similar."** All members of a matched group are structurally
  identical after normalization (that's what makes them a group) — there's no meaningful
  ordering among them to compute.

## Design

### 1. `packages/core/src/analyzer/similar-code.ts` (new)

```ts
import type { Graph } from '../types.js';
import { detectDuplicates } from './duplication.js';

export interface SimilarCodeMatch {
  nodeId: string;
  label: string;
  file: string;
}

export interface SimilarCodeResult {
  nodeId: string;
  matches: SimilarCodeMatch[];
}

/** Finds other nodes structurally near-identical to `nodeId`, by looking up
 * which detectDuplicates (015) group it belongs to, if any. */
export function findSimilarCode(graph: Graph, nodeId: string): SimilarCodeResult {
  const groups = detectDuplicates(graph);
  const group = groups.find(g => g.nodes.some(n => n.nodeId === nodeId));
  const matches = group ? group.nodes.filter(n => n.nodeId !== nodeId) : [];
  return { nodeId, matches };
}
```

### 2. `packages/core/src/index.ts` export

```ts
export { findSimilarCode } from './analyzer/similar-code.js';
export type { SimilarCodeResult, SimilarCodeMatch } from './analyzer/similar-code.js';
```

### 3. `packages/mcp/src/handlers.ts` — `handleFindSimilarCode`

Same shape as `handleTraceImpact`: load the graph, call `findSimilarCode`, format a text list of
matches (file + label), or a clear "no similar code found" message when the match list is empty
— same convention as every prior handler, not an error for the empty case (a node having no
duplicates is a normal, common outcome, not a failure).

### 4. `packages/mcp/src/index.ts` — new tool registration

```ts
{
  name: "find_similar_code",
  description:
    "Find other functions/methods structurally near-identical to a given node (same control-flow shape, robust to renaming).",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_name: { type: "string", description: "Project name" },
      node_id: { type: "string", description: "Node ID to find similar code for" },
    },
    required: ["project_name", "node_id"],
  },
},
```

### 5. `packages/cli/src/commands/similar-code.ts` (new) + `bin/nodum.ts` registration

```
🧬 Code similar to validateUserInput (src/api/users.ts): 1 match

  - validateOrderInput (src/api/orders.ts)

(or, if none:)
✅ No similar code found
```

## Acceptance criteria

- [x] A node whose `detectDuplicates` group has other members returns exactly those other
      members, excluding itself.
- [x] A node with a `duplicateHash` but no group partner (a unique hash) returns `[]`.
- [x] A node with no `duplicateHash` at all (below spec 015's threshold) returns `[]`, not an
      error.
- [x] A nonexistent node ID returns `[]`, not an error.
- [x] `find_similar_code` MCP tool returns a formatted match list; an empty result is a clear
      "no similar code" message, not `{ error }`.
- [x] `nodum similar-code` prints a formatted list and exits 0.
- [x] `nodum similar-code --json` prints the raw `SimilarCodeResult` object.
- [x] `nodum similar-code` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/similar-code.test.ts` (new) — constructed `Graph` fixtures: a group
with 2+ members (returns the others), a unique hash (returns `[]`), no hash at all (returns
`[]`), nonexistent node ID (returns `[]`) — plus a direct cross-check that the matches equal what
`detectDuplicates` itself reports for the same fixture, minus the origin node.

`packages/mcp/src/handlers.test.ts` (extend) — `handleFindSimilarCode`: formatted match list,
"no similar code" message.

`packages/cli/src/commands/similar-code.test.ts` (new) — following the established mocking
convention: formatted output, `--json`, "no similar code," missing synced project.

## Success Metrics

- Real check: reuse (or rebuild) spec 015's real end-to-end fixture — the renamed-but-
  structurally-identical TS function pair (`validateUserInput`/`validateOrderInput`) — sync it,
  run `nodum similar-code <path> <validateUserInput's node id>`, confirm `validateOrderInput` is
  the sole reported match.
- Real check: `nodum similar-code` against `benchmarks/projects/sample-next-app` for a node
  known (from spec 015's own verification) to have no duplicates — confirm a clean "no similar
  code" result.

## Related

Depends on: `015-code-duplication-detection` (`detectDuplicates`, reused directly, not
re-implemented).
