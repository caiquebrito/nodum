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
// enrichment, not meaningful to a structural diff) and `clusterId`
// (positional, renumbered every sync — comparing it would flag nearly every
// node as "changed" for no structural reason).
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
    if (changedFields.length > 0) {
      changed.push({ id, before, after, changedFields });
    }
  }

  const edgeKey = (e: Edge): string => `${e.source}|${e.target}|${e.relation}`;
  const aEdgeKeys = new Set(a.edges.map(edgeKey));
  const bEdgeKeys = new Set(b.edges.map(edgeKey));
  const edgesAdded = b.edges.filter(e => !aEdgeKeys.has(edgeKey(e)));
  const edgesRemoved = a.edges.filter(e => !bEdgeKeys.has(edgeKey(e)));

  const statsDelta = Object.fromEntries(
    (Object.keys(b.stats) as Array<keyof Graph['stats']>).map(k => [k, b.stats[k] - a.stats[k]]),
  ) as Record<keyof Graph['stats'], number>;

  return {
    statsDelta,
    nodes: { added, removed, changed },
    edges: { added: edgesAdded, removed: edgesRemoved },
  };
}
