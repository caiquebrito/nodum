import type { Graph } from '../types.js';

export interface ComplexityRanking {
  nodeId: string;
  label: string;
  file: string;
  complexity: number;
  /** Which metric `complexity` above holds — 'cyclomatic' (McCabe, the
   * default) or 'cognitive' (SonarSource-inspired, spec 045). */
  metric: 'cyclomatic' | 'cognitive';
}

export interface RankByComplexityOptions {
  threshold?: number;
  /** Defaults to 'cyclomatic' — the metric this function has always ranked
   * by. 'cognitive' ranks by `Node.cognitiveComplexity` instead (spec 045),
   * rewarding flat code over deeply nested code the way cyclomatic doesn't.
   * `findBottlenecks`/`suggestRefactoring` intentionally keep calling this
   * with the default — see spec 045's Out of scope. */
  metric?: 'cyclomatic' | 'cognitive';
}

/** Ranks scored function/method nodes by complexity (cyclomatic by default), descending. */
export function rankByComplexity(graph: Graph, options: RankByComplexityOptions = {}): ComplexityRanking[] {
  const metric = options.metric ?? 'cyclomatic';
  const field = metric === 'cognitive' ? 'cognitiveComplexity' : 'complexity';

  return graph.nodes
    .filter((n): n is typeof n & { complexity: number } => n[field] !== undefined)
    .filter(n => options.threshold === undefined || n[field]! >= options.threshold)
    .sort((a, b) => b[field]! - a[field]!)
    .map(n => ({ nodeId: n.id, label: n.label, file: n.file, complexity: n[field]!, metric }));
}
