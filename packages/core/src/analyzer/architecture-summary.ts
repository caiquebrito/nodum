import type { Graph } from '../types.js';
import { detectArchitectureViolations } from './architecture.js';
import type { ArchitectureViolation } from './architecture.js';
import type { ArchitectureRule } from './architecture-config.js';

export interface LayerSummary {
  group: string;
  fileCount: number;
  /** Functions + classes + interfaces + methods whose owning file belongs to this group. */
  nodeCount: number;
}

export interface LayerDependency {
  sourceGroup: string;
  targetGroup: string;
  importCount: number;
}

export interface ArchitectureSummary {
  layers: LayerSummary[];
  layerDependencies: LayerDependency[];
  /** Undefined when no rules were passed — distinguishes "not configured" from
   * "configured, zero violations" (an empty array). */
  violations?: ArchitectureViolation[];
}

/**
 * Aggregates the graph up to group ("layer") level: which layers exist, how
 * many imports flow between each pair (including self-pairs), and —
 * optionally — declared-rule violations via detectArchitectureViolations
 * (013), reused directly rather than re-implemented.
 */
export function explainArchitecture(graph: Graph, rules?: ArchitectureRule[]): ArchitectureSummary {
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
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
    const sourceGroup = groupByFile.get(nodesById.get(edge.source)?.file ?? '');
    const targetGroup = groupByFile.get(nodesById.get(edge.target)?.file ?? '');
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
