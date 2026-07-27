# 011 — Dependency cycle detection (circular imports)

## Status: done

Implemented, tested (9 new `cycles.test.ts` core tests + 5 new CLI `cycles.test.ts` tests, all
passing alongside the full existing suite), and verified end-to-end against real files on disk:
- Scratch fixture with a genuine `a.ts ↔ b.ts` circular import plus an unrelated
  `isolated.ts`: `nodum sync` then `nodum cycles` correctly reported exactly one cycle
  (`src/b.ts → src/a.ts → src/b.ts`), and `--json` produced the matching `Cycle[]` shape.
  `isolated.ts` did not appear in the output.
- `benchmarks/projects/sample-next-app` (no real cycles): `nodum cycles` printed a clean
  "No circular imports found" and exited 0.

## Goal

Detect circular import chains (`A → B → C → A`) in a synced project's graph and surface them
through both a pure `packages/core` analysis function and a new `nodum cycles` CLI command.
This is the first of the "Advanced Graph Analysis" roadmap items and the direct payoff of
spec 010 — before that spec, the graph had zero cross-file `imports` edges, so cycle
detection had nothing to operate on. Confirmed by reading the current graph: `imports` edges
now exist and connect real file nodes; nothing in the codebase computes cycles from them yet
(`grep -rn "cycle\|Cycle"` across `packages/core|cli|mcp` returns no matches).

## Why now

Directly unblocked by spec 010. Also a prerequisite named in the roadmap's dependency chain
for later analysis specs (`013-architecture-violation-detection` and the `explain_architecture`
MCP tool both want to know about cyclic dependencies), though this spec only delivers cycle
detection itself — no downstream consumers yet.

## Scope

- Detect cycles among **file nodes**, using only `imports`-relation edges. `defines`/`extends`/
  `implements` edges are structural (file→member, class hierarchy), not dependency edges, and
  including them would conflate "this file defines this function" with "this file depends on
  that file" — a meaningless mix for the "circular imports" framing the roadmap asks for.
- A pure, synchronous core function operating on an already-loaded `Graph`, `Node`, and `Edge`
  set — no file-system or parsing logic. It composes with the existing `imports` edges spec
  010 already produces; it doesn't add new edge-resolution logic.
- One representative cycle path reported per strongly-connected component of size > 1 (see
  Design — this matches how existing tools like ESLint's `import/no-cycle` report cycles: one
  concrete example chain per cycle group, not every elementary cycle within it).
- A `nodum cycles [projectPath] [--json]` CLI command, following the exact pattern of
  `nodum diff`/`nodum export` (resolve `graph.json` for a synced project, run the pure
  function, print a formatted summary or raw JSON).

## Out of scope

- **Every elementary cycle within a large strongly-connected component.** Enumerating all
  simple cycles (Johnson's algorithm) is combinatorially expensive on real codebases — a
  10-file SCC can have hundreds of elementary cycles. One representative chain per SCC,
  consistent with how similar tools report this, is the useful signal; exhaustive enumeration
  is not.
- **Auto-fix / refactoring suggestions.** Detection only.
- **MCP tool exposure.** Per the existing task breakdown, MCP tools for analysis results are
  separate specs (016–020) layered on top of the analysis specs (011–015). This spec ships the
  detection capability and a CLI surface for it; wiring it into an MCP tool is later work.
- **Cross-language cycles spanning e.g. a TS file and a Kotlin file.** Not a real scenario given
  today's resolvers (TS/JS relative-path vs Kotlin/Java FQN never cross-resolve into each
  other's file types), so this isn't something the algorithm needs to special-case — it falls
  out naturally from operating on whatever `imports` edges already exist.

## Design

### 1. `packages/core/src/analyzer/cycles.ts` (new)

```ts
import type { Graph } from '../types.js';

export interface Cycle {
  /** Node IDs forming the cycle, in traversal order. First and last are NOT repeated. */
  nodeIds: string[];
  /** File paths, same order as nodeIds, for human-readable reporting. */
  files: string[];
}

/**
 * Detects circular `imports` chains among file nodes. Returns one representative
 * cycle per strongly-connected component of size > 1 (or a single self-importing
 * node), computed via Tarjan's SCC algorithm, then a DFS within each SCC's
 * induced subgraph to recover one concrete cycle path.
 */
export function detectCycles(graph: Graph): Cycle[] {
  const importEdges = graph.edges.filter(e => e.relation === 'imports');

  const adjacency = new Map<string, string[]>();
  for (const edge of importEdges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  const sccs = tarjanSCC(adjacency);
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

  const cycles: Cycle[] = [];
  for (const scc of sccs) {
    const hasSelfLoop = scc.length === 1 && (adjacency.get(scc[0]) ?? []).includes(scc[0]);
    if (scc.length < 2 && !hasSelfLoop) continue;

    const path = findCyclePath(scc, adjacency);
    cycles.push({
      nodeIds: path,
      files: path.map(id => nodesById.get(id)?.file ?? id),
    });
  }

  return cycles;
}

// tarjanSCC(adjacency): standard iterative-or-recursive Tarjan's algorithm,
// returns string[][] (one array of node IDs per SCC, singletons included).
// findCyclePath(scc, adjacency): DFS restricted to the SCC's own node set,
// starting from scc[0], returning the first back-edge cycle found as an
// ordered node-ID path.
```

`Node`/`Edge`/`Graph` types are unchanged — this is a read-only analysis over the existing
shape, same category as `graph-diff.ts` and `analyzer/clustering.ts`.

### 2. Export from `packages/core/src/index.ts`

```ts
export { detectCycles } from './analyzer/cycles.js';
export type { Cycle } from './analyzer/cycles.js';
```

### 3. `packages/cli/src/commands/cycles.ts` (new)

Same shape as `commands/export.ts`: resolve `${nodumDataDir}/${projectName}/graph/graph.json`,
error with the same "Run `nodum sync` first" message if missing, run `detectCycles`, print
either raw JSON (`--json`) or a formatted summary:

```
🔁 Dependency cycles: 2 found

  1. src/a.ts → src/b.ts → src/c.ts → src/a.ts
  2. src/x.ts → src/x.ts (self-import)

(or, if none:)
✅ No circular imports found
```

### 4. `packages/cli/src/bin/nodum.ts`

New `nodum cycles [projectPath]` command registered alongside `diff`/`export`, same
`nodumDataDir` resolution and try/catch/`process.exit(1)` pattern as every other command.

## Acceptance criteria

- [x] `detectCycles` returns `[]` for an acyclic graph (a straight-line or tree-shaped import
      structure).
- [x] `detectCycles` finds a 2-file cycle (`A → B → A`).
- [x] `detectCycles` finds a 3+-file cycle (`A → B → C → A`).
- [x] `detectCycles` finds a self-import (`A → A`) as its own trivial cycle.
- [x] A file with no incoming or outgoing `imports` edges never appears in any reported cycle.
- [x] Non-`imports` edges (`defines`/`extends`/`implements`) never influence cycle detection —
      a graph with only those relation types, however densely connected, reports no cycles.
- [x] A large strongly-connected component reports one representative path, not an explosion of
      every elementary cycle within it (regression guard against runaway output on real
      codebases with a tangled core module).
- [x] `nodum cycles` on a synced project with a real circular import prints a human-readable
      chain and exits 0.
- [x] `nodum cycles` on a synced project with no cycles prints a clear "no cycles" message and
      exits 0 (not treated as an error).
- [x] `nodum cycles --json` prints the raw `Cycle[]` array.
- [x] `nodum cycles` on a project that hasn't been synced yet fails with the same
      "Run `nodum sync` first" guidance `export`/`diff` already use, not a raw stack trace.

## Test plan

`packages/core/src/analyzer/cycles.test.ts` (new) — pure function, constructed `Graph` fixtures
covering every acceptance-criteria case above: acyclic, 2-cycle, 3+-cycle, self-import, isolated
node, non-`imports`-edge graph, and a synthetic larger SCC to assert exactly one path is
returned per component.

`packages/cli/src/commands/cycles.test.ts` (new) — following `diff.test.ts`'s/`export.test.ts`'s
mocking convention (mock `fs/promises` read of `graph.json`), covering: cycle found → formatted
output, no cycles → formatted "none" message, `--json` → raw JSON, missing synced project →
thrown error with the expected message.

## Success Metrics

- Real check: build a small scratch fixture with a genuine circular import (`a.ts` imports
  `b.ts`, `b.ts` imports `a.ts`), sync it, and run `nodum cycles` — confirms detection works
  against a real synced graph, not just unit-tested fixtures.
- Real check: run `nodum cycles` against `benchmarks/projects/sample-next-app` (no known
  cycles in that fixture today) — confirms a clean "no cycles" result on a real acyclic
  project, not just that the function returns `[]` in isolation.

## Related

Depends on: `010-import-edge-resolution` (needs real `imports` edges to operate on).
Blocks: `013-architecture-violation-detection`, the `explain_architecture` MCP tool
(`018-mcp-explain-architecture`) — both want cycle information, layered on later.
