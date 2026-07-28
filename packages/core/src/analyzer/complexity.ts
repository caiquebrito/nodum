import type { Graph } from '../types.js';

export interface ComplexityRanking {
  nodeId: string;
  label: string;
  file: string;
  complexity: number;
}

export interface RankByComplexityOptions {
  threshold?: number;
}

/** Ranks scored function/method nodes by cyclomatic complexity, descending. */
export function rankByComplexity(graph: Graph, options: RankByComplexityOptions = {}): ComplexityRanking[] {
  return graph.nodes
    .filter((n): n is typeof n & { complexity: number } => n.complexity !== undefined)
    .filter(n => options.threshold === undefined || n.complexity >= options.threshold)
    .sort((a, b) => b.complexity - a.complexity)
    .map(n => ({ nodeId: n.id, label: n.label, file: n.file, complexity: n.complexity }));
}
