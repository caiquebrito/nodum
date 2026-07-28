import type { Graph } from '../types.js';
import { detectDuplicates } from './duplication.js';

export interface SimilarCodeMatch {
  nodeId: string;
  label: string;
  file: string;
}

export interface SimilarCodeResult {
  nodeId: string;
  matches: SimilarCodeMatch[];
}

/**
 * Finds other nodes structurally near-identical to `nodeId`, by looking up
 * which detectDuplicates (015) group it belongs to, if any. A node with no
 * duplicateHash, a unique hash, or a nonexistent ID all naturally produce
 * an empty match list — none of them will appear in any group.
 */
export function findSimilarCode(graph: Graph, nodeId: string): SimilarCodeResult {
  const groups = detectDuplicates(graph);
  const group = groups.find(g => g.nodes.some(n => n.nodeId === nodeId));
  const matches = group ? group.nodes.filter(n => n.nodeId !== nodeId) : [];
  return { nodeId, matches };
}
