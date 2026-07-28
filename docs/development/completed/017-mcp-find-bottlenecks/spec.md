# 017 — MCP `find_bottlenecks` (identify high-complexity areas)

## Status: done

Implemented, tested (157 core tests total including new `analyzer/bottlenecks.test.ts`; 80 CLI
tests total including new `commands/bottlenecks.test.ts`; 9 MCP tests total including extended
`handlers.test.ts` coverage for `handleFindBottlenecks`), and verified end-to-end against real
files on disk:
- A scratch fixture with two files containing an identically complex function (hand-verified 8:
  1 base + if + && + for + inner-if + else-if + || + ternary), one imported by two other files
  and one isolated: `nodum bottlenecks --json` correctly ranked the popular file first
  (score=24, complexity=8, dependents=2) above the isolated one (score=8, dependents=0).
- `benchmarks/projects/sample-next-app`: `nodum bottlenecks`'s top result
  (`src/api/middleware.ts`, complexity=3, dependents=1) was cross-checked directly against
  `nodum complexity`'s already-verified output (spec 014 — `authMiddleware` = 3) and
  `nodum trace-impact`'s already-verified output (spec 016 — 1 file depends on
  `middleware.ts`), confirming both components of the composite score independently.

## Goal

Rank files by a composite "bottleneck" signal — how complex their code is, combined with how
many other files transitively depend on them — so the highest-risk files to touch surface first.
Ships as a pure `packages/core` function, a new `find_bottlenecks` MCP tool, and a companion
`nodum bottlenecks [projectPath] [--json] [--limit N]` CLI command (same verification-vehicle
posture as spec 016).

## Why now

Second of the five MCP-enhancement specs, depending on `014-complexity-scoring`. Directly
buildable now: `rankByComplexity` (014) and `traceImpact` (016) already exist in
`packages/core` — this spec's job is combining them, not building new primitives from scratch.

**Design call, not a feasibility gap**: the roadmap's one-line description — "identify
high-complexity areas" — could be read as simply re-exposing spec 014's complexity ranking
through an MCP tool. That would make this spec nearly redundant with `nodum complexity`, which
already ships. The more useful signal, and the one actually implemented here: **complexity
alone doesn't tell you which complex code is risky to touch** — a highly complex function in a
file nothing else depends on is much lower-stakes than a moderately complex function in a file
half the project imports. Combining complexity with `traceImpact`'s transitive dependent count
answers the more useful question a "bottleneck" framing implies. This is a design decision
(same category as specs 011/013/015's calls), so it's written and presented directly.

## Scope

- Ranks at **file granularity**, not function granularity. Reasoning: `traceImpact` (016) only
  has real dependency signal between files (the graph's `imports` edges never connect
  individual functions — no call/reference edges exist, the same limitation specs 012/016
  already documented). Combining a function-level complexity score with a file-level dependent
  count would conflate two different units; ranking files avoids that mismatch while still
  surfacing the useful "which complex file is riskiest" signal — a file's `maxComplexity` is the
  highest complexity score among the functions/methods it defines.
- `packages/core/src/analyzer/bottlenecks.ts`: `findBottlenecks(graph, options?)` — for every
  file node with at least one scored function/method, computes:
  - `maxComplexity`: highest `complexity` among that file's function/method nodes (via each
    node's existing `file` field — no new edge traversal needed).
  - `dependentCount`: `traceImpact(graph, fileId).length` — every file transitively affected by
    changing this one, reusing 016's BFS as-is rather than re-implementing fan-in counting.
  - Sorted descending by `maxComplexity * (1 + dependentCount)` — multiplicative so a heavily
    depended-upon file amplifies its complexity's weight, but a complexity of 0 doesn't get
    zeroed entirely by a `× 0` (the `+1`), and a file with zero dependents still ranks by its
    raw complexity. Both raw components are returned alongside the score, not just the score
    itself, so the ranking is auditable rather than a black box.
  - **`options.limit`**: caps the returned ranking to the top N (default: all).
- `find_bottlenecks` MCP tool (new `handleFindBottlenecks` in `handlers.ts`, registered in
  `index.ts`) — `project_name`, optional `limit`, formatted text summary (same convention as
  every other handler).
- `nodum bottlenecks [projectPath] [--json] [--limit N]` CLI command — same shape as every prior
  analysis command, used as the real end-to-end verification vehicle.

## Out of scope

- **Function-level bottleneck ranking.** Granularity mismatch explained above — not feasible
  without call/reference edges that don't exist.
- **Any complexity metric beyond spec 014's cyclomatic score.** Cognitive complexity is still
  unscheduled (spec 014's own deferral, unchanged).
- **Configurable scoring formulas.** One fixed formula (`maxComplexity * (1 + dependentCount)`),
  not a pluggable weighting system — avoids over-engineering a knob nobody has asked for yet.
- **Auto-refactoring suggestions.** Ranking only, same posture as every prior analysis spec.

## Design

### 1. `packages/core/src/analyzer/bottlenecks.ts` (new)

```ts
import type { Graph } from '../types.js';
import { rankByComplexity } from './complexity.js';
import { traceImpact } from './impact.js';

export interface Bottleneck {
  fileNodeId: string;
  file: string;
  maxComplexity: number;
  dependentCount: number;
  score: number;
}

export interface FindBottlenecksOptions {
  limit?: number;
}

export function findBottlenecks(graph: Graph, options: FindBottlenecksOptions = {}): Bottleneck[] {
  const scoredByFile = new Map<string, number>(); // file path -> max complexity
  for (const ranked of rankByComplexity(graph)) {
    const current = scoredByFile.get(ranked.file) ?? 0;
    if (ranked.complexity > current) scoredByFile.set(ranked.file, ranked.complexity);
  }

  const bottlenecks: Bottleneck[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const maxComplexity = scoredByFile.get(node.file);
    if (maxComplexity === undefined) continue; // no scored functions in this file

    const dependentCount = traceImpact(graph, node.id).length;
    bottlenecks.push({
      fileNodeId: node.id,
      file: node.file,
      maxComplexity,
      dependentCount,
      score: maxComplexity * (1 + dependentCount),
    });
  }

  bottlenecks.sort((a, b) => b.score - a.score);
  return options.limit !== undefined ? bottlenecks.slice(0, options.limit) : bottlenecks;
}
```

### 2. `packages/core/src/index.ts` export

```ts
export { findBottlenecks } from './analyzer/bottlenecks.js';
export type { Bottleneck, FindBottlenecksOptions } from './analyzer/bottlenecks.js';
```

### 3. `packages/mcp/src/handlers.ts` — `handleFindBottlenecks`

Same shape as `handleTraceImpact`: load the graph, call `findBottlenecks`, format a ranked text
list (file, score, and the two raw components), same "not raw JSON" convention as every other
handler.

### 4. `packages/mcp/src/index.ts` — new tool registration

```ts
{
  name: "find_bottlenecks",
  description:
    "Rank files by a composite bottleneck score — code complexity combined with how many other files transitively depend on them.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_name: { type: "string", description: "Project name" },
      limit: { type: "number", description: "Optional: cap the number of results" },
    },
    required: ["project_name"],
  },
},
```

### 5. `packages/cli/src/commands/bottlenecks.ts` (new) + `bin/nodum.ts` registration

```
🔥 Bottlenecks (top 10)

  1. src/api/routes.ts        score=24  complexity=8  dependents=2
  2. src/lib/auth.ts          score=12  complexity=4  dependents=2
  ...

(or, if no scored functions exist anywhere:)
✅ No scored functions found
```

## Acceptance criteria

- [x] A file with a high-complexity function and many transitive dependents ranks above a file
      with the same complexity but no dependents.
- [x] A file with no scored functions (spec 014's threshold/AST-availability gaps) is excluded
      entirely from the ranking, not scored as 0.
- [x] `maxComplexity` reflects the *highest* complexity among a file's functions, not a sum or
      average.
- [x] `dependentCount` matches what `traceImpact` would report directly for that file (reuses
      it, not a re-implementation — a divergence would be a bug).
- [x] `options.limit` caps the returned array; omitting it returns every scored file.
- [x] `find_bottlenecks` MCP tool returns a formatted ranked summary; a project with no scored
      functions returns a clear "none found" message, not an error.
- [x] `nodum bottlenecks` prints a formatted ranked list and exits 0.
- [x] `nodum bottlenecks --json` prints the raw `Bottleneck[]` array.
- [x] `nodum bottlenecks --limit N` caps the output.
- [x] `nodum bottlenecks` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/bottlenecks.test.ts` (new) — constructed `Graph` fixtures: complexity
+ dependents both present and correctly combined, files with no scored functions excluded,
`limit` behavior, `maxComplexity` picks the max not sum/average, and a direct cross-check that
`dependentCount` equals `traceImpact(...).length` for the same fixture.

`packages/mcp/src/handlers.test.ts` (extend) — `handleFindBottlenecks`: formatted output,
"none found."

`packages/cli/src/commands/bottlenecks.test.ts` (new) — following the established mocking
convention: formatted output, `--json`, `--limit`, missing synced project.

## Success Metrics

- Real check: a scratch fixture where one file has a genuinely complex function (several
  `if`/`for`/`&&`) and is imported by two other files, versus a second file with an equally
  complex function but zero importers — sync it, confirm `nodum bottlenecks` ranks the
  heavily-depended-upon file first.
- Real check: `nodum bottlenecks` against `benchmarks/projects/sample-next-app` — manually
  cross-check the top result's `maxComplexity` against `nodum complexity`'s already-verified
  output (spec 014) and its `dependentCount` against `nodum trace-impact`'s already-verified
  output (spec 016) for the same file.

## Related

Depends on: `014-complexity-scoring` (`rankByComplexity`), `016-mcp-trace-impact`
(`traceImpact`) — this spec composes both rather than adding new graph-traversal logic.
