import type { Graph, Node } from '@caiquebrito/nodum-core';

type ExportNode = Omit<Node, 'embedding' | 'similaritySignature'>;

// `similaritySignature` (spec 048) is meaningless outside nodum's own
// findSimilarCode lookup path — stripped from exports alongside the
// existing `embedding` strip, same rationale (internal-only field, would
// only bloat GraphML/JSON/CSV output).
function stripInternalFields(graph: Graph): { nodes: ExportNode[]; edges: Graph['edges'] } {
  return {
    nodes: graph.nodes.map(({ embedding, similaritySignature, ...rest }) => rest),
    edges: graph.edges,
  };
}

export function toJSON(graph: Graph): string {
  const { nodes, edges } = stripInternalFields(graph);
  return JSON.stringify({ project: graph.project, stats: graph.stats, nodes, edges }, null, 2);
}

const GRAPHML_NODE_KEYS = [
  ['d0', 'label', 'string'],
  ['d1', 'type', 'string'],
  ['d2', 'file', 'string'],
  ['d3', 'group', 'string'],
  ['d4', 'line', 'int'],
  ['d5', 'clusterId', 'string'],
] as const;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toGraphML(graph: Graph): string {
  const { nodes, edges } = stripInternalFields(graph);

  const keyDefs =
    GRAPHML_NODE_KEYS.map(
      ([id, name, type]) => `  <key id="${id}" for="node" attr.name="${name}" attr.type="${type}"/>`,
    ).join('\n') + `\n  <key id="d6" for="edge" attr.name="relation" attr.type="string"/>`;

  const nodeXml = nodes
    .map(n => {
      const record = n as unknown as Record<string, unknown>;
      const data = GRAPHML_NODE_KEYS.filter(([, name]) => record[name] !== undefined)
        .map(([id, name]) => `      <data key="${id}">${escapeXml(String(record[name]))}</data>`)
        .join('\n');
      return `    <node id="${escapeXml(n.id)}">\n${data}\n    </node>`;
    })
    .join('\n');

  const edgeXml = edges
    .map(
      (e, i) =>
        `    <edge id="e${i}" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}">\n      <data key="d6">${escapeXml(e.relation)}</data>\n    </edge>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n${keyDefs}\n  <graph id="${escapeXml(graph.project)}" edgedefault="directed">\n${nodeXml}\n${edgeXml}\n  </graph>\n</graphml>\n`;
}

function csvField(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvExport {
  nodesCsv: string;
  edgesCsv: string;
}

export function toCSV(graph: Graph): CsvExport {
  const { nodes, edges } = stripInternalFields(graph);

  const nodeHeader = ['id', 'label', 'type', 'file', 'group', 'line', 'clusterId'];
  const nodesCsv =
    [nodeHeader.join(','), ...nodes.map(n => nodeHeader.map(k => csvField((n as Record<string, unknown>)[k])).join(','))].join(
      '\n',
    ) + '\n';

  const edgeHeader = ['source', 'target', 'relation'];
  const edgesCsv =
    [
      edgeHeader.join(','),
      ...edges.map(e => edgeHeader.map(k => csvField((e as unknown as Record<string, unknown>)[k])).join(',')),
    ].join('\n') + '\n';

  return { nodesCsv, edgesCsv };
}
