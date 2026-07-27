# 009 — `nodum diff`: compare two graph snapshots

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (core 36/36 incl. 6 new graph-diff.test.ts, cli 37/37 incl. 5 new diff.test.ts), and real end-to-end: exported a snapshot of the synced sample-next-app fixture, added a function, re-synced, diffed snapshot against current state — reported exactly 1 added node and functions delta +1, matching the spec exactly. --json output verified valid and correctly structured. Unresolvable-argument error case verified for real (correct message naming the failing arg, exit code 1).

## Goal

`nodum diff <a> <b> [--json]` — compare two graph snapshots and report what changed: nodes added/removed/modified, edges added/removed, and stat deltas. Each of `<a>`/`<b>` can be either a path to a `graph.json`-shaped file (e.g. one saved via `nodum export --format json`) or a project name/path, resolved to that project's current synced graph the same way `nodum export`/`config` do.

## Why now

Last unclaimed item in the roadmap's "Enhanced CLI" section. There's no versioned history of past syncs (each sync overwrites `graph.json` in place), so "diff" here means comparing two graph *files* the user already has — most naturally, a snapshot saved via `nodum export --format json` before some change, against the project's current synced state after it.

## Scope

- `packages/core/src/graph-diff.ts` (new) — `diffGraphs(a: Graph, b: Graph): GraphDiff`, pure function, no I/O. Lives in `core` (not `cli`) since it operates purely on the `Graph` type core already owns, and is a natural candidate for MCP to expose as a tool later (not part of this spec, but no reason to bury it in `cli`).
- `packages/cli/src/commands/diff.ts` (new) — resolves each argument (file path vs. project name) to a `Graph`, calls `diffGraphs`, formats output.
- `packages/cli/src/bin/nodum.ts` — new `nodum diff <a> <b>` command with a `--json` flag for machine-readable output.

## Out of scope

- Any new snapshot-history/versioning system (e.g., auto-saving a copy of `graph.json` on every sync) — diffing works against whatever two files the user already has. A future spec could add `nodum sync --save-snapshot`, but that's a different, bigger feature.
- Diffing clusters (`clusters`/`nodeToCluster`) — cluster IDs are positional and get fully renumbered on every sync (spec 002's clustering notes), so comparing them would produce noisy, meaningless "changes" even when nothing structurally moved. Diffing intentionally covers `nodes`/`edges`/`stats` only.
- Diffing the `embedding` field — MCP-only enrichment, not meaningful to a structural graph diff, and would make every node in an MCP-embedded graph look "changed" against a CLI-only-synced one.

## Design

**`packages/core/src/graph-diff.ts`**:

```ts
import type { Graph, Node, Edge } from './types.js';

export interface NodeChange {
  id: string;
  before: Node;
  after: Node;
  changedFields: Array<keyof Node>;
}

export interface GraphDiff {
  statsDelta: Record<keyof Graph['stats'], number>; // b.stats[k] - a.stats[k]
  nodes: {
    added: Node[];
    removed: Node[];
    changed: NodeChange[];
  };
  edges: {
    added: Edge[];
    removed: Edge[];
  };
}

// Fields compared for "changed" — deliberately excludes `embedding` (MCP-only
// enrichment) and `clusterId` (positional, renumbered every sync — comparing
// it would flag nearly every node as "changed" for no structural reason).
const COMPARED_FIELDS: Array<keyof Node> = ['label', 'type', 'file', 'group', 'line'];

export function diffGraphs(a: Graph, b: Graph): GraphDiff {
  const aNodes = new Map(a.nodes.map(n => [n.id, n]));
  const bNodes = new Map(b.nodes.map(n => [n.id, n]));

  const added = b.nodes.filter(n => !aNodes.has(n.id));
  const removed = a.nodes.filter(n => !bNodes.has(n.id));
  const changed: NodeChange[] = [];
  for (const [id, before] of aNodes) {
    const after = bNodes.get(id);
    if (!after) continue;
    const changedFields = COMPARED_FIELDS.filter(f => before[f] !== after[f]);
    if (changedFields.length > 0) changed.push({ id, before, after, changedFields });
  }

  const edgeKey = (e: Edge): string => `${e.source}|${e.target}|${e.relation}`;
  const aEdgeKeys = new Set(a.edges.map(edgeKey));
  const bEdgeKeys = new Set(b.edges.map(edgeKey));
  const edgesAdded = b.edges.filter(e => !aEdgeKeys.has(edgeKey(e)));
  const edgesRemoved = a.edges.filter(e => !bEdgeKeys.has(edgeKey(e)));

  const statsDelta = Object.fromEntries(
    (Object.keys(b.stats) as Array<keyof Graph['stats']>).map(k => [k, b.stats[k] - a.stats[k]]),
  ) as Record<keyof Graph['stats'], number>;

  return { statsDelta, nodes: { added, removed, changed }, edges: { added: edgesAdded, removed: edgesRemoved } };
}
```

**`packages/cli/src/commands/diff.ts`** — argument resolution (file vs. project) and human-readable formatting:

```ts
import { resolve, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { diffGraphs } from '@caiquebrito/nodum-core';

async function resolveGraph(arg: string, nodumDataDir: string): Promise<Graph> {
  const absolute = resolve(arg);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    return JSON.parse(await readFile(absolute, 'utf-8'));
  }
  const projectName = basename(absolute);
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;
  try {
    return JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`Could not resolve "${arg}" as a file or a synced project. Run \`nodum sync\` first, or pass a graph.json path.`);
  }
}

export async function diffCommand(a: string, b: string, nodumDataDir: string, options: { json?: boolean }): Promise<void> {
  const [graphA, graphB] = await Promise.all([resolveGraph(a, nodumDataDir), resolveGraph(b, nodumDataDir)]);
  const diff = diffGraphs(graphA, graphB);

  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(`📊 Graph diff: ${a} → ${b}\n`);
  console.log('Stats:');
  for (const [key, delta] of Object.entries(diff.statsDelta)) {
    const sign = delta > 0 ? '+' : '';
    console.log(`  ${key.padEnd(11)} ${(graphA.stats as any)[key]} → ${(graphB.stats as any)[key]}  (${sign}${delta})`);
  }
  console.log(`\n+ Added nodes (${diff.nodes.added.length})`);
  diff.nodes.added.forEach(n => console.log(`  + ${n.label} (${n.type}) in ${n.file}`));
  console.log(`\n- Removed nodes (${diff.nodes.removed.length})`);
  diff.nodes.removed.forEach(n => console.log(`  - ${n.label} (${n.type}) in ${n.file}`));
  console.log(`\n~ Changed nodes (${diff.nodes.changed.length})`);
  diff.nodes.changed.forEach(c =>
    console.log(`  ~ ${c.before.label}: ${c.changedFields.map(f => `${f} "${c.before[f]}" → "${c.after[f]}"`).join(', ')}`),
  );
  console.log(`\n+ Added edges (${diff.edges.added.length})`);
  console.log(`- Removed edges (${diff.edges.removed.length})`);
}
```

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('diff <a> <b>')
  .description('Compare two graph snapshots (file paths or synced project names)')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (a: string, b: string, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { diffCommand } = await import('../commands/diff.js');
      await diffCommand(a, b, nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
```

## Acceptance criteria

- [x] `diffGraphs` correctly classifies a node present in both as unchanged when no `COMPARED_FIELDS` value differs — even if `clusterId`/`embedding` differ between the two graphs.
- [x] A node whose `file` (or `label`/`type`/`group`/`line`) differs between `a` and `b` is reported in `changed` with the correct `changedFields`.
- [x] Edge added/removed detection is order-independent (same edges in different array order → no false diff).
- [x] `statsDelta` is `b - a` per stat key, including negative deltas when something shrank.
- [x] `nodum diff <file> <file>` works with two arbitrary `graph.json`-shaped files, no synced project required.
- [x] `nodum diff <project> <project>` (project name/path, not a file) resolves both to `${nodumDataDir}/<name>/graph/graph.json`.
- [x] An argument that's neither an existing file nor a synced project errors clearly, naming which argument failed to resolve.
- [x] `--json` output is valid JSON matching the `GraphDiff` shape; without it, output is the human-readable summary.

## Test plan

`packages/core/src/graph-diff.test.ts` (new) — pure function, no mocks needed:
- Identical graphs → empty `added`/`removed`/`changed` for both nodes and edges, all-zero `statsDelta`.
- A node only in `b` → `added`; only in `a` → `removed`.
- A node in both with a different `file` → `changed`, `changedFields: ['file']`.
- A node in both differing only in `clusterId`/`embedding` → **not** reported as changed.
- Edges reordered between `a`/`b` with identical content → no added/removed.
- `statsDelta` sign correctness for both increases and decreases.

`packages/cli/src/commands/diff.test.ts` (new) — mock `fs/promises`/`fs`:
- Two file-path arguments resolve directly via `readFile`, no `nodumDataDir` path touched.
- Two project-name arguments resolve via the `${nodumDataDir}/<name>/graph/graph.json` convention.
- An unresolvable argument throws, naming the failing argument.
- `--json` prints valid JSON; without it, prints the formatted summary (spot-check a few expected lines/substrings).

## Success Metrics

- Real check: sync `benchmarks/projects/sample-next-app`, export a JSON snapshot, add a function to one source file, sync again, `nodum diff <snapshot> .` — reports exactly one added node and a `functions` stat delta of `+1`.

## Related

Independent of specs 003–008. Reuses nothing from incremental sync directly — it diffs whatever two graph files it's given, regardless of how they were produced.
