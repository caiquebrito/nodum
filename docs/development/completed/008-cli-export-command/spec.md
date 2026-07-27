# 008 — `nodum export`: export graphs to JSON/GraphML/CSV

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (cli 32/32 incl. 3 new export-formats.test.ts + 7 new export.test.ts cases), and real end-to-end export of the synced sample-next-app fixture to all 3 formats: JSON has 27 nodes/23 edges with zero embedding fields, GraphML parses cleanly with Python real XML parser (27 nodes/23 edges), CSV row counts exactly match node/edge counts + header. No-sync error case also verified for real (correct message, exit code 1).

## Goal

`nodum export [projectPath] --format <json|graphml|csv> [--output <path>]` — turn an already-synced project's graph into a form other tools can consume: a trimmed JSON snapshot, GraphML for graph-visualization tools (Gephi, yEd, Cytoscape), or a pair of CSV files for spreadsheets/data tools.

## Why now

Next unclaimed item in the roadmap's "Enhanced CLI" section. Genuinely different from just `cat`-ing `graph.json`: the stored graph includes `embedding` vectors on every node (multi-hundred-float arrays, meaningless outside nodum's own semantic search) that bloat any external use of the data, and nothing today produces GraphML or CSV at all.

## Scope

- `packages/cli/src/commands/export.ts` (new) — loads the already-synced graph for a project (does **not** re-sync), strips `embedding` from every node, dispatches to a format writer.
- `packages/cli/src/export-formats.ts` (new) — `toJSON`, `toGraphML`, `toCSV` — pure functions, `Graph → string` (or, for CSV, `Graph → { nodesCsv: string; edgesCsv: string }`), independently testable without touching the filesystem.
- `packages/cli/src/bin/nodum.ts` — new `nodum export [projectPath]` command with `--format` (default `json`) and `--output`.

## Out of scope

- Re-syncing before export — if the project hasn't been synced, the command errors and points at `nodum sync`, rather than silently running one (that's a surprising side effect for a command named "export").
- Any other export format (DOT/GEXF/etc.) — three formats is the scope; more can be added later without touching this design.
- Exporting clusters as a separate concept in GraphML/CSV — `clusterId` is exported as a per-node attribute/column (already on `Node`), but cluster *summaries* (label, external deps) aren't part of any format here.

## Design

**`packages/cli/src/export-formats.ts`**:

```ts
import type { Graph, Node } from '@caiquebrito/nodum-core';

type ExportNode = Omit<Node, 'embedding'>;

function stripEmbeddings(graph: Graph): { nodes: ExportNode[]; edges: Graph['edges'] } {
  return {
    nodes: graph.nodes.map(({ embedding, ...rest }) => rest),
    edges: graph.edges,
  };
}

export function toJSON(graph: Graph): string {
  const { nodes, edges } = stripEmbeddings(graph);
  return JSON.stringify({ project: graph.project, stats: graph.stats, nodes, edges }, null, 2);
}

export function toGraphML(graph: Graph): string {
  const { nodes, edges } = stripEmbeddings(graph);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nodeKeys = [
    ['d0', 'label', 'string'], ['d1', 'type', 'string'], ['d2', 'file', 'string'],
    ['d3', 'group', 'string'], ['d4', 'line', 'int'], ['d5', 'clusterId', 'string'],
  ] as const;

  const keyDefs = nodeKeys.map(([id, name, type]) => `  <key id="${id}" for="node" attr.name="${name}" attr.type="${type}"/>`).join('\n')
    + `\n  <key id="d6" for="edge" attr.name="relation" attr.type="string"/>`;

  const nodeXml = nodes.map(n => {
    const data = nodeKeys
      .filter(([, name]) => (n as any)[name] !== undefined)
      .map(([id, name]) => `      <data key="${id}">${esc(String((n as any)[name]))}</data>`)
      .join('\n');
    return `    <node id="${esc(n.id)}">\n${data}\n    </node>`;
  }).join('\n');

  const edgeXml = edges.map((e, i) =>
    `    <edge id="e${i}" source="${esc(e.source)}" target="${esc(e.target)}">\n      <data key="d6">${esc(e.relation)}</data>\n    </edge>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n${keyDefs}\n  <graph id="${esc(graph.project)}" edgedefault="directed">\n${nodeXml}\n${edgeXml}\n  </graph>\n</graphml>\n`;
}

function csvField(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(graph: Graph): { nodesCsv: string; edgesCsv: string } {
  const { nodes, edges } = stripEmbeddings(graph);
  const nodeHeader = ['id', 'label', 'type', 'file', 'group', 'line', 'clusterId'];
  const nodesCsv = [
    nodeHeader.join(','),
    ...nodes.map(n => nodeHeader.map(k => csvField((n as any)[k])).join(',')),
  ].join('\n') + '\n';

  const edgeHeader = ['source', 'target', 'relation'];
  const edgesCsv = [
    edgeHeader.join(','),
    ...edges.map(e => edgeHeader.map(k => csvField((e as any)[k])).join(',')),
  ].join('\n') + '\n';

  return { nodesCsv, edgesCsv };
}
```

**`packages/cli/src/commands/export.ts`**:

```ts
import { resolve, basename } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { toJSON, toGraphML, toCSV } from '../export-formats.js';

export type ExportFormat = 'json' | 'graphml' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  output?: string;
}

export async function exportGraph(projectPath: string, nodumDataDir: string, options: ExportOptions): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  switch (options.format) {
    case 'json': {
      const out = options.output ?? `${projectName}.graph.json`;
      await writeFile(out, toJSON(graph), 'utf-8');
      console.log(`✅ Exported JSON: ${out}`);
      break;
    }
    case 'graphml': {
      const out = options.output ?? `${projectName}.graphml`;
      await writeFile(out, toGraphML(graph), 'utf-8');
      console.log(`✅ Exported GraphML: ${out}`);
      break;
    }
    case 'csv': {
      const base = options.output ?? projectName;
      const { nodesCsv, edgesCsv } = toCSV(graph);
      await writeFile(`${base}.nodes.csv`, nodesCsv, 'utf-8');
      await writeFile(`${base}.edges.csv`, edgesCsv, 'utf-8');
      console.log(`✅ Exported CSV: ${base}.nodes.csv, ${base}.edges.csv`);
      break;
    }
    default:
      throw new Error(`Unknown export format: "${options.format}". Use json, graphml, or csv.`);
  }
}
```

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('export [projectPath]')
  .description('Export a synced project\'s graph to JSON, GraphML, or CSV')
  .option('--format <format>', 'json | graphml | csv', 'json')
  .option('--output <path>', 'Output path (base path for csv, which writes two files)')
  .action(async (projectPath: string | undefined, options: { format: string; output?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { exportGraph } = await import('../commands/export.js');
      await exportGraph(projectPath || process.cwd(), nodumDataDir, {
        format: options.format as 'json' | 'graphml' | 'csv',
        output: options.output,
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
```

## Acceptance criteria

- [x] Exporting a project with no prior sync errors with a message pointing at `nodum sync`, doesn't create any output file.
- [x] JSON export: valid JSON, no node has an `embedding` field, every other node/edge field preserved.
- [x] GraphML export: well-formed XML (parseable by a standard XML parser), one `<node>` per graph node with matching `id`, one `<edge>` per graph edge with matching `source`/`target`, a `relation` data value on every edge.
- [x] CSV export: two files written (`<base>.nodes.csv`, `<base>.edges.csv`), row counts match `nodes.length`/`edges.length` (plus header), a label containing a comma or double-quote round-trips correctly (properly quoted/escaped).
- [x] Default output paths derive from the project name; `--output` overrides them (as an exact path for json/graphml, as a base path for csv).
- [x] An unrecognized `--format` value errors clearly instead of silently defaulting or crashing with a stack trace.

## Test plan

`packages/cli/src/export-formats.test.ts` (new) — pure function tests, no filesystem:
- `toJSON`: embeddings stripped, all other fields preserved, valid `JSON.parse()` round-trip.
- `toGraphML`: parse the output with a real XML parser (e.g. Node's built-in or a tiny regex-free check via `DOMParser`-equivalent — whatever's already available; if nothing is, a simple well-formedness check via a minimal parser is acceptable) and assert node/edge counts and attribute values match the input graph.
- `toCSV`: row counts match input; a node with a label containing `,` and `"` produces a correctly quoted/escaped field that reconstructs to the original value when parsed back.

`packages/cli/src/commands/export.test.ts` (new) — mock `fs/promises`:
- No graph on disk → throws the "run nodum sync first" error, `writeFile` never called.
- `format: 'json'` writes to the default `<project>.graph.json` path when `output` is omitted.
- `format: 'csv'` writes exactly two files with the expected names.
- `--output` overrides the default path/base correctly per format.
- Unknown format throws before any write.

## Success Metrics

- Real check: sync `benchmarks/projects/sample-next-app`, then `nodum export --format graphml` — the output opens without error in any GraphML-aware tool, or at minimum round-trips through Node's own XML capabilities without a parse error.
- Real check: `nodum export --format csv` on the same project — `wc -l` on `nodes.csv` equals node count + 1 (header).

## Related

Independent of specs 003–007. Reads whatever `nodum sync` last wrote — works with both full and incremental syncs since the on-disk `graph.json` shape is identical either way.
