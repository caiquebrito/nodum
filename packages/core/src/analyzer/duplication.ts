import type { Graph } from '../types.js';

export interface DuplicateGroup {
  hash: string;
  nodes: { nodeId: string; label: string; file: string }[];
}

/** Groups function/method nodes sharing a duplicateHash. Only groups with
 * 2+ members are returned — a unique hash isn't a duplicate of anything. */
export function detectDuplicates(graph: Graph): DuplicateGroup[] {
  const byHash = new Map<string, DuplicateGroup['nodes']>();
  for (const n of graph.nodes) {
    if (!n.duplicateHash) continue;
    const list = byHash.get(n.duplicateHash) ?? [];
    list.push({ nodeId: n.id, label: n.label, file: n.file });
    byHash.set(n.duplicateHash, list);
  }
  return [...byHash.entries()].filter(([, nodes]) => nodes.length >= 2).map(([hash, nodes]) => ({ hash, nodes }));
}
