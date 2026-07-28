# 018 — MCP `explain_architecture` (auto-generate architecture docs)

## Status: done

Implemented, tested (164 core tests total including new `analyzer/architecture-summary.test.ts`;
84 CLI tests total including new `commands/explain-architecture.test.ts`; 11 MCP tests total
including extended `handlers.test.ts` coverage for `handleExplainArchitecture`), and verified
end-to-end against real files on disk:
- A scratch fixture across `ui`/`db` groups with a real cross-group import and a `.nodumrc.json`
  rule that import violates: `nodum explain-architecture`'s violations section matched
  `nodum architecture`'s (spec 013) own output for the identical rule exactly.
- `benchmarks/projects/sample-next-app` (no rules configured): correctly showed the
  "not configured" message, and `layerDependencies` (`service→util: 2`, `service→service: 1`,
  `service→repo: 1`, summing to 4) exactly matched the real `imports` edges already established
  and verified in specs 010/011.

Along the way, discovered that MCP handlers previously had no way to read a project's
`.nodumrc.json` (they only ever knew the synced project *name*, not its original source path) —
resolved by looking up the path via the existing `projects.json` index (`ProjectIndexEntry.path`,
already tracked, just not previously used for this purpose).

## Goal

Auto-generate a project's architecture overview: which layers (groups) exist, how they depend
on each other at an aggregate level, and whether any of that violates the project's own declared
rules (spec 013). Ships as a pure `packages/core` function, a new `explain_architecture` MCP
tool, and a companion `nodum explain-architecture [projectPath] [--json]` CLI command.

## Why now

Third of the five MCP-enhancement specs, depending on `010-import-edge-resolution` and
`013-architecture-violation-detection` per the roadmap's own dependency ordering. Both are
shipped. This spec composes them plus the existing `NODE_GROUPS`/`getNodeGroup` classification
(already computed on every node since the original clustering feature) rather than adding new
graph-traversal primitives — same compositional posture as spec 017.

**Design call, not a feasibility gap**: `013-architecture-violation-detection` already reports
violations against declared rules, and a naive version of this spec could just be "call that and
relabel it." What's actually new and matches "auto-generate architecture docs" more literally:
aggregating `imports` edges **up to group level** (`ui → service: 12 imports`, not just
individual file pairs) to produce a genuine layer-dependency overview — the kind of diagram a
human would draw by hand — with declared-rule violations folded in as one section of that larger
picture, not the whole output.

## Scope

- `packages/core/src/analyzer/architecture-summary.ts`: `explainArchitecture(graph, rules?)` —
  pure, computing:
  - **`layers`**: for each `group` value actually present among the graph's file nodes (not the
    full fixed `NODE_GROUPS` list — a project with no `hook`-grouped files shouldn't get a
    "hooks: 0 files" line), a count of files and a count of non-file nodes (functions + classes
    + interfaces + methods) whose `file` belongs to that group.
  - **`layerDependencies`**: aggregates every `imports` edge by `(sourceGroup, targetGroup)`
    pair, with a count — computed by mapping each edge's source/target file node to its `group`
    field (already on every node, no new lookup logic beyond what spec 013's
    `detectArchitectureViolations` already does for the same purpose). Self-pairs
    (`service → service`) are included — a layer's internal cohesion is part of the picture,
    not noise to filter.
  - **`violations`**: `rules` is optional; when provided, runs `detectArchitectureViolations`
    (013) and includes its result directly — reusing it, not re-implementing rule-matching.
    Omitted (not an empty array) when no rules are given, so "no rules configured" and "rules
    configured, zero violations" stay distinguishable in the output.
- `explain_architecture` MCP tool — `project_name`; loads `.nodumrc.json`'s architecture rules
  the same way `handleArchitecture`-equivalent CLI logic already does (013's
  `loadArchitectureConfig`), so violations are included automatically when rules exist for the
  project, without requiring the caller to pass anything extra.
- `nodum explain-architecture [projectPath] [--json]` CLI command — same shape as every prior
  analysis command, used as the real end-to-end verification vehicle.

## Out of scope

- **Auto-generating a persisted architecture doc file** (e.g. writing `ARCHITECTURE.md` to the
  project). "Auto-generate architecture docs" is interpreted here as *producing* the explanatory
  content on demand through the MCP tool/CLI, matching how every other analysis spec in this
  series works (on-demand query, not a file-writing side effect) — not a new file-output
  concern this spec doesn't otherwise need.
- **Inferring an architecture** where none is declared. If no rules exist in `.nodumrc.json`,
  the tool still reports layers and dependencies (real, observable structure) but never guesses
  at what rules *should* exist — same "never invent the intended architecture" posture spec 013
  already committed to.
- **Visual diagram generation** (Mermaid, GraphML, etc.). Text/JSON output only, consistent with
  every other CLI/MCP analysis command shipped so far; `nodum export --format graphml` already
  exists for anyone who wants a visual export of the full graph.
- **Cluster-based ("semantic module") summaries.** The existing v2.0 clustering feature
  (`buildClusters`/`NodeCluster`) is a different concept — semantic grouping, not the
  directory-driven `NODE_GROUPS` layering this spec (and spec 013) already operate on. Mixing
  the two would conflate distinct classification systems; not attempted here.

## Design

### 1. `packages/core/src/analyzer/architecture-summary.ts` (new)

```ts
import type { Graph } from '../types.js';
import { detectArchitectureViolations, type ArchitectureRule, type ArchitectureViolation } from './architecture.js';

export interface LayerSummary {
  group: string;
  fileCount: number;
  nodeCount: number; // functions + classes + interfaces + methods in this layer
}

export interface LayerDependency {
  sourceGroup: string;
  targetGroup: string;
  importCount: number;
}

export interface ArchitectureSummary {
  layers: LayerSummary[];
  layerDependencies: LayerDependency[];
  violations?: ArchitectureViolation[];
}

export function explainArchitecture(graph: Graph, rules?: ArchitectureRule[]): ArchitectureSummary {
  const fileNodes = graph.nodes.filter(n => n.type === 'file');
  const groupByFile = new Map(fileNodes.map(n => [n.file, n.group]));

  const layerCounts = new Map<string, { fileCount: number; nodeCount: number }>();
  for (const node of graph.nodes) {
    const group = node.type === 'file' ? node.group : groupByFile.get(node.file);
    if (!group) continue;
    const counts = layerCounts.get(group) ?? { fileCount: 0, nodeCount: 0 };
    if (node.type === 'file') counts.fileCount++;
    else counts.nodeCount++;
    layerCounts.set(group, counts);
  }
  const layers = [...layerCounts.entries()].map(([group, c]) => ({ group, ...c }));

  const depCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.relation !== 'imports') continue;
    const sourceGroup = groupByFile.get(graph.nodes.find(n => n.id === edge.source)?.file ?? '');
    const targetGroup = groupByFile.get(graph.nodes.find(n => n.id === edge.target)?.file ?? '');
    if (!sourceGroup || !targetGroup) continue;
    const key = `${sourceGroup}|${targetGroup}`;
    depCounts.set(key, (depCounts.get(key) ?? 0) + 1);
  }
  const layerDependencies = [...depCounts.entries()].map(([key, importCount]) => {
    const [sourceGroup, targetGroup] = key.split('|');
    return { sourceGroup, targetGroup, importCount };
  });

  return {
    layers,
    layerDependencies,
    ...(rules ? { violations: detectArchitectureViolations(graph, rules) } : {}),
  };
}
```

(Final implementation will build a `nodeId -> node` map once up front rather than repeated
`.find()` calls, matching this codebase's established performance conventions elsewhere — e.g.
`graph-gen.ts`'s `nodesById` pattern.)

### 2. `packages/core/src/index.ts` export

```ts
export { explainArchitecture } from './analyzer/architecture-summary.js';
export type { ArchitectureSummary, LayerSummary, LayerDependency } from './analyzer/architecture-summary.js';
```

### 3. `packages/mcp/src/handlers.ts` — `handleExplainArchitecture`

Loads the graph and `loadArchitectureConfig` for the project (same as the CLI's `architecture`
command already does), calls `explainArchitecture`, formats a text summary: a layer inventory,
a dependency-direction list, and a violations section only when rules were configured.

### 4. `packages/mcp/src/index.ts` — new tool registration

```ts
{
  name: "explain_architecture",
  description:
    "Auto-generate an architecture overview: layers present, how they depend on each other, and any violations of the project's declared architecture rules.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_name: { type: "string", description: "Project name" },
    },
    required: ["project_name"],
  },
},
```

### 5. `packages/cli/src/commands/explain-architecture.ts` (new) + `bin/nodum.ts` registration

```
🏛️  Architecture overview: my-app

Layers:
  service    3 files, 8 nodes
  repo       1 file, 3 nodes
  util       2 files, 4 nodes

Dependencies between layers:
  service → repo     5 imports
  service → util     2 imports

Architecture rules: 1 configured
Violations: 0 found
```

(When no rules are configured, the last two lines become
`Architecture rules: (none configured — run \`nodum config --set-architecture-rules\` to add some)`.)

## Acceptance criteria

- [x] Only groups actually present among the graph's file nodes appear in `layers` — a group
      with zero files is absent, not listed with `fileCount: 0`.
- [x] `layers[].nodeCount` counts functions/classes/interfaces/methods whose owning file belongs
      to that group, not files themselves.
- [x] `layerDependencies` aggregates by group pair with a correct `imports`-edge count, including
      self-pairs (`service → service`) when they occur.
- [x] Non-`imports` edges never contribute to `layerDependencies`.
- [x] `violations` is `undefined` (not `[]`) when no rules are passed; a real array (possibly
      empty) when rules are passed, distinguishing "not configured" from "configured, clean" —
      reuses `detectArchitectureViolations` directly, not a second implementation.
- [x] `explain_architecture` MCP tool automatically includes violations when the project has
      `.nodumrc.json` architecture rules, without the caller passing anything extra.
- [x] `nodum explain-architecture` prints a formatted layer + dependency + violations summary
      and exits 0.
- [x] `nodum explain-architecture --json` prints the raw `ArchitectureSummary` object.
- [x] `nodum explain-architecture` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/architecture-summary.test.ts` (new) — constructed `Graph` fixtures:
layer counts (files vs. nodes), group-pair aggregation including a self-pair, non-`imports`
edges excluded, `violations` present vs. `undefined` depending on whether `rules` was passed,
and a direct cross-check that passing rules produces the same violations
`detectArchitectureViolations` would return standalone.

`packages/mcp/src/handlers.test.ts` (extend) — `handleExplainArchitecture`: formatted output
with and without configured rules.

`packages/cli/src/commands/explain-architecture.test.ts` (new) — following the established
mocking convention: formatted output, `--json`, "no rules configured" wording, missing synced
project.

## Success Metrics

- Real check: a scratch fixture with files across at least two groups (e.g. `ui/`, `db/`) and a
  real cross-group import — sync it, confirm `nodum explain-architecture` reports the correct
  layer counts and the correct `sourceGroup → targetGroup` dependency count.
- Real check: the same fixture with a `.nodumrc.json` architecture rule that the real import
  violates — confirm the violations section matches `nodum architecture`'s (spec 013) own
  already-verified output for the identical rule.
- Real check: `nodum explain-architecture` against `benchmarks/projects/sample-next-app` —
  manually cross-check the reported layer/dependency counts against the real files and imports
  already verified in specs 010/011/013.

## Related

Depends on: `010-import-edge-resolution` (`imports` edges), `013-architecture-violation-detection`
(`detectArchitectureViolations`, reused directly).
