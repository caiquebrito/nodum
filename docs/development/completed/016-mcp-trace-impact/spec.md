# 016 — MCP `trace_impact` (show cascade of changes if you modify X)

## Status: done

Implemented, tested (152 core tests total including new `analyzer/impact.test.ts`; 74 CLI tests
total including new `commands/trace-impact.test.ts`; 7 MCP tests total including the
first-ever `handlers.test.ts` in this package), and verified end-to-end against real files on
disk:
- A scratch 3-file transitive import chain (`a.ts` imports `b.ts` imports `c.ts`): `nodum
  trace-impact <path> src_c_ts` correctly reported `b.ts` at 1 hop and `a.ts` at 2 hops. Tracing
  from the function node `src_c_ts__c` instead of the file node produced an identical result,
  confirming function-to-owning-file resolution works.
- `benchmarks/projects/sample-next-app`, tracing from `src/lib/auth.ts`: correctly reported both
  `middleware.ts` and `routes.ts` at 1 hop — cross-checked against the real `imports` edges
  already established and verified in specs 010/011 (`middleware.ts→auth.ts` and
  `routes.ts→auth.ts` are both direct edges).

## Goal

Given a node (file, function, class, etc.), show every file that would be transitively affected
by changing it — walking `imports` edges backwards from the target, however many hops deep.
Ships as a pure `packages/core` function, a new `trace_impact` MCP tool, and (following this
session's established practice of using the CLI as the real end-to-end verification vehicle for
every spec) a companion `nodum trace-impact <projectPath> <nodeId> [--max-depth N] [--json]`
command.

## Why now

First of the five MCP-enhancement specs (016–020) that consume the "Advanced Graph Analysis"
work (010–015) just shipped. Confirmed while researching: the MCP server already has a
`get_dependents` tool (`handleGetDeps` with `direction: "incoming"` in `handlers.ts`), but it's
**one hop only** — it shows direct importers, not the transitive cascade "what modifying X
ultimately touches" that the roadmap's `trace_impact` description asks for. This spec is the
transitive version of that same idea, not a duplicate of existing functionality.

## Scope

- `packages/core/src/analyzer/impact.ts`: `traceImpact(graph, nodeId, options?)` — pure BFS over
  incoming `imports` edges only, starting from the target node's **owning file**. `imports`
  edges only ever connect file nodes (confirmed by re-reading spec 010's resolver output and
  `graph-gen.ts`'s `resolveImportsInto`), so if `nodeId` refers to a function/method/class/
  interface node, the function first resolves it to its containing file (via that node's
  existing `file` field, matched against the corresponding file node's `id`) before tracing.
  Returns every file transitively reachable by walking incoming `imports` edges, each tagged
  with its hop distance from the origin, visited-set-guarded so a real import cycle (spec 011
  confirmed these exist) can't cause an infinite loop.
- **Options**: `maxDepth?: number` — caps how many hops to report, for readability on large
  graphs; unlimited (bounded only by the graph's own size, via the visited set) when omitted.
- `trace_impact` MCP tool in `packages/mcp` (new `handleTraceImpact` in `handlers.ts`,
  registered in `index.ts`'s tool list, same pattern as every existing tool) — takes
  `project_name`, `node_id`, optional `max_depth`, returns a formatted text summary (same
  human-readable convention as `handleGetDeps`, not raw JSON — MCP tool output is read by the
  model, and every existing handler in this file follows that convention).
- `nodum trace-impact <projectPath> <nodeId> [--max-depth N] [--json]` CLI command — same
  `graph.json`-resolution/error-handling shape as every CLI command from specs 011–015, used as
  the real end-to-end verification vehicle for this spec (an MCP tool is much more friction to
  exercise directly than a CLI command against a real synced project).

## Out of scope

- **Per-function impact narrowing within an affected file.** The graph has no call/reference
  edges (confirmed originally during spec 012's research, still true) — once a file is flagged
  as transitively impacted, there's no data to determine *which* of its functions actually use
  the changed symbol, only that the file imports (directly or transitively) the file containing
  it. Same honest-limitation posture as spec 012's dead-code candidates.
- **`extends`/`implements` edges.** These `RelationType` values exist in the type system but no
  parser has ever emitted them (confirmed in spec 010's own research, unchanged since) — there's
  nothing to traverse even if this spec wanted to include them.
- **Suggesting *how* to make the change safely** — impact tracing only, no refactoring guidance.
  That's a different, unscheduled capability.
- **Weighting/ranking impacted files by "how affected."** Every file at a given hop distance is
  reported equivalently; no attempt to guess severity.

## Design

### 1. `packages/core/src/analyzer/impact.ts` (new)

```ts
import type { Graph } from '../types.js';

export interface ImpactedFile {
  nodeId: string;
  file: string;
  /** Hop distance from the origin node's file, via incoming imports edges. */
  distance: number;
}

export interface TraceImpactOptions {
  maxDepth?: number;
}

/**
 * BFS over incoming `imports` edges, starting from `nodeId`'s owning file
 * (resolved via that node's `file` field if `nodeId` isn't itself a file
 * node). Returns every file transitively reachable — i.e. every file that
 * would be affected by changing the target — excluding the origin file
 * itself. Cycle-safe via a visited set.
 */
export function traceImpact(graph: Graph, nodeId: string, options: TraceImpactOptions = {}): ImpactedFile[] {
  const startNode = graph.nodes.find(n => n.id === nodeId);
  if (!startNode) return [];

  const fileNodesByPath = new Map(graph.nodes.filter(n => n.type === 'file').map(n => [n.file, n]));
  const originFile = startNode.type === 'file' ? startNode : fileNodesByPath.get(startNode.file);
  if (!originFile) return [];

  const incomingImports = new Map<string, string[]>(); // target file id -> source file ids
  for (const edge of graph.edges) {
    if (edge.relation !== 'imports') continue;
    if (!incomingImports.has(edge.target)) incomingImports.set(edge.target, []);
    incomingImports.get(edge.target)!.push(edge.source);
  }

  const visited = new Set<string>([originFile.id]);
  const result: ImpactedFile[] = [];
  let frontier = [originFile.id];
  let distance = 0;

  while (frontier.length > 0 && (options.maxDepth === undefined || distance < options.maxDepth)) {
    distance++;
    const next: string[] = [];
    for (const fileId of frontier) {
      for (const sourceId of incomingImports.get(fileId) ?? []) {
        if (visited.has(sourceId)) continue;
        visited.add(sourceId);
        next.push(sourceId);
      }
    }
    const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
    for (const id of next) {
      result.push({ nodeId: id, file: nodesById.get(id)?.file ?? id, distance });
    }
    frontier = next;
  }

  return result;
}
```

### 2. `packages/core/src/index.ts` export

```ts
export { traceImpact } from './analyzer/impact.js';
export type { ImpactedFile, TraceImpactOptions } from './analyzer/impact.js';
```

### 3. `packages/mcp/src/handlers.ts` — `handleTraceImpact`

Loads the graph, calls `traceImpact`, formats a text summary grouped by distance (mirroring
`handleGetDeps`'s grouping/truncation style — cap displayed items per group with a "...and N
more" tail), returns `{ error }` if the node isn't found (matching `handleGetDeps`'s existing
error convention).

### 4. `packages/mcp/src/index.ts` — new tool registration

```ts
{
  name: "trace_impact",
  description:
    "Show every file transitively affected by changing a given file/function/class — the cascade of changes if you modify X.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_name: { type: "string", description: "Project name" },
      node_id: { type: "string", description: "Node ID to trace impact from" },
      max_depth: { type: "number", description: "Optional: cap how many hops to report" },
    },
    required: ["project_name", "node_id"],
  },
},
```

Dispatched in the `CallToolRequestSchema` switch, same pattern as every existing case.

### 5. `packages/cli/src/commands/trace-impact.ts` (new) + `bin/nodum.ts` registration

Same `graph.json`-resolution shape as `cycles`/`dead-code`/etc. Formatted output:

```
📡 Impact of changing src/lib/auth.ts: 3 files

  1 hop:
    - src/api/middleware.ts
    - src/api/routes.ts
  2 hops:
    - src/api/server.ts

(or, if nothing depends on it:)
✅ No files depend on src/lib/auth.ts
```

## Acceptance criteria

- [x] Tracing from a file with no importers returns `[]`.
- [x] Tracing from a file with one direct importer returns that file at distance 1.
- [x] Tracing from a file with a transitive importer (A imports B imports target) returns B at
      distance 1 and A at distance 2.
- [x] Tracing from a function/method/class/interface node resolves to its owning file first and
      traces from there (same result as tracing from that file node directly).
- [x] A real import cycle in the graph does not cause an infinite loop or a duplicate entry for
      any file (visited-set guard).
- [x] `options.maxDepth` caps the reported hop distance; omitting it reports every reachable
      file.
- [x] Tracing from a nonexistent node ID returns `[]`, not a thrown error.
- [x] `trace_impact` MCP tool: valid `project_name`/`node_id` returns a formatted grouped
      summary; a nonexistent `node_id` returns `{ error }`, matching `handleGetDeps`'s
      convention.
- [x] `nodum trace-impact` on a synced project prints a formatted, distance-grouped list and
      exits 0.
- [x] `nodum trace-impact` when nothing depends on the target prints a clear "no files depend on
      X" message, not an error.
- [x] `nodum trace-impact --json` prints the raw `ImpactedFile[]` array.
- [x] `nodum trace-impact` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/impact.test.ts` (new) — constructed `Graph` fixtures covering every
acceptance-criteria case above: no importers, direct importer, transitive importer with correct
distances, resolving from a function node to its file, cycle safety, `maxDepth`, nonexistent
node.

`packages/mcp/src/handlers.test.ts` (new — **first-ever handler test in this package**, per
research; only `embeddings.test.ts` exists today) — `handleTraceImpact` with a mocked
`readFile`/graph, covering: formatted grouped output, nonexistent node → `{ error }`.

`packages/cli/src/commands/trace-impact.test.ts` (new) — following the established mocking
convention: formatted output, "nothing depends on it," `--json`, `--max-depth`, missing synced
project.

## Success Metrics

- Real check: a scratch fixture with a 3-file transitive import chain (`a.ts` imports `b.ts`
  imports `c.ts`) — sync it, run `nodum trace-impact <path> <c's node id>`, confirm `b.ts`
  reports at distance 1 and `a.ts` at distance 2.
- Real check: the same fixture, tracing impact of a *function* node inside `c.ts` — confirm it
  resolves to the same result as tracing `c.ts` the file directly.
- Real check: `nodum trace-impact` against `benchmarks/projects/sample-next-app`, tracing from
  `src/lib/auth.ts` — manually cross-check the reported impacted files against the real
  `imports` edges already verified in specs 010/011.

## Related

Depends on: `010-import-edge-resolution` (needs real `imports` edges),
`011-dependency-cycle-detection` (confirms cycles are a real scenario this must handle safely).
Related but distinct from the existing `get_dependents` tool (one-hop only).
