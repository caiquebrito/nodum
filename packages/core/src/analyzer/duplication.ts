import type { Graph } from '../types.js';

export interface DuplicateGroup {
  hash: string;
  nodes: { nodeId: string; label: string; file: string }[];
}

/**
 * True when every member of `nodeIds` has a `calls` edge to at least one
 * common target. An identical normalized token stream that's *entirely* a
 * thin wrapper delegating to the same shared helper (differing only in
 * literal call args, which normalize to `LIT` the same as any other
 * literal) is the presence of reuse, not duplicated logic to extract —
 * extracting a "shared implementation" out of two callers that already
 * share one would be a no-op. A group where the members call *different*
 * helpers (or none at all) is unaffected — that's genuine duplicated logic.
 */
function delegatesToSharedHelper(nodeIds: string[], callsByNode: Map<string, Set<string>>): boolean {
  let intersection: Set<string> | undefined;
  for (const id of nodeIds) {
    const calls = callsByNode.get(id);
    if (!calls || calls.size === 0) return false;
    const prior = intersection;
    intersection = prior ? new Set([...prior].filter(t => calls.has(t))) : new Set(calls);
    if (intersection.size === 0) return false;
  }
  return (intersection?.size ?? 0) > 0;
}

/** Groups function/method nodes sharing a duplicateHash. Only groups with
 * 2+ members are returned — a unique hash isn't a duplicate of anything.
 * Groups whose members all already delegate to the same shared helper
 * (see `delegatesToSharedHelper`) are excluded — that's reuse, not
 * duplication needing a fix. */
export function detectDuplicates(graph: Graph): DuplicateGroup[] {
  const byHash = new Map<string, DuplicateGroup['nodes']>();
  for (const n of graph.nodes) {
    if (!n.duplicateHash) continue;
    const list = byHash.get(n.duplicateHash) ?? [];
    list.push({ nodeId: n.id, label: n.label, file: n.file });
    byHash.set(n.duplicateHash, list);
  }

  const callsByNode = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.relation !== 'calls') continue;
    const targets = callsByNode.get(e.source) ?? new Set();
    targets.add(e.target);
    callsByNode.set(e.source, targets);
  }

  return [...byHash.entries()]
    .filter(([, nodes]) => nodes.length >= 2)
    .filter(([, nodes]) => !delegatesToSharedHelper(nodes.map(n => n.nodeId), callsByNode))
    .map(([hash, nodes]) => ({ hash, nodes }));
}
