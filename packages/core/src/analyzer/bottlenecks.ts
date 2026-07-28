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

/**
 * Ranks files by a composite bottleneck score: how complex their code is
 * (spec 014's rankByComplexity, taking the max per file), combined with how
 * many other files transitively depend on them (spec 016's traceImpact).
 * File granularity only — the graph has no per-function dependency edges to
 * rank on. Files with no scored functions are excluded, not scored as 0.
 */
export function findBottlenecks(graph: Graph, options: FindBottlenecksOptions = {}): Bottleneck[] {
  const maxComplexityByFile = new Map<string, number>();
  for (const ranked of rankByComplexity(graph)) {
    const current = maxComplexityByFile.get(ranked.file) ?? 0;
    if (ranked.complexity > current) maxComplexityByFile.set(ranked.file, ranked.complexity);
  }

  const bottlenecks: Bottleneck[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const maxComplexity = maxComplexityByFile.get(node.file);
    if (maxComplexity === undefined) continue;

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
