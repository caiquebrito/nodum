import type { Graph } from '../types.js';
import type { ArchitectureRule } from './architecture-config.js';

export interface ArchitectureViolation {
  rule: ArchitectureRule;
  sourceNodeId: string;
  sourceFile: string;
  targetNodeId: string;
  targetFile: string;
}

/**
 * Flags `imports` edges whose (source group, target group) pair matches a
 * declared deny rule. '*' in a rule matches any group. No rules -> no
 * violations; this is opt-in, not an inferred or default architecture.
 */
export function detectArchitectureViolations(graph: Graph, rules: ArchitectureRule[]): ArchitectureViolation[] {
  if (rules.length === 0) return [];

  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const violations: ArchitectureViolation[] = [];

  for (const edge of graph.edges) {
    if (edge.relation !== 'imports') continue;
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;

    const matchedRule = rules.find(
      r => (r.from === '*' || r.from === source.group) && (r.to === '*' || r.to === target.group),
    );
    if (matchedRule) {
      violations.push({
        rule: matchedRule,
        sourceNodeId: source.id,
        sourceFile: source.file,
        targetNodeId: target.id,
        targetFile: target.file,
      });
    }
  }

  return violations;
}
