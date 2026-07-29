import type { Graph } from '../types.js';
import { detectCycles } from './cycles.js';
import { detectUnreachableFiles } from './dead-code.js';
import { detectArchitectureViolations } from './architecture.js';
import type { ArchitectureRule } from './architecture-config.js';
import { rankByComplexity } from './complexity.js';
import { detectDuplicates } from './duplication.js';
import { detectNearDuplicates } from './near-duplicate.js';

export type RefactoringSuggestionKind =
  | 'cycle'
  | 'architecture-violation'
  | 'high-complexity'
  | 'duplication'
  | 'near-duplication'
  | 'dead-code';

export interface RefactoringSuggestion {
  kind: RefactoringSuggestionKind;
  description: string;
  files: string[];
}

export interface SuggestRefactoringOptions {
  /** Omit entirely (not []) when no rules are configured — never invent an architecture. */
  architectureRules?: ArchitectureRule[];
  /** Default 10 — a common linter default for "this function is too complex," not a claimed
   * universal standard. Overridable. */
  complexityThreshold?: number;
}

/**
 * Synthesizes a unified refactoring-suggestion feed from every analysis
 * capability shipped in this series (011-015) — zero new detection logic,
 * pure composition. Fixed category ordering, not a cross-category priority
 * score (see spec 020's Scope for why).
 */
export function suggestRefactoring(graph: Graph, options: SuggestRefactoringOptions = {}): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  for (const cycle of detectCycles(graph)) {
    suggestions.push({
      kind: 'cycle',
      description: `Circular import: ${[...cycle.files, cycle.files[0]].join(' → ')}`,
      files: cycle.files,
    });
  }

  if (options.architectureRules) {
    for (const v of detectArchitectureViolations(graph, options.architectureRules)) {
      suggestions.push({
        kind: 'architecture-violation',
        description: `${v.sourceFile} imports ${v.targetFile}, violating the declared [${v.rule.from} → ${v.rule.to}] rule`,
        files: [v.sourceFile, v.targetFile],
      });
    }
  }

  const threshold = options.complexityThreshold ?? 10;
  for (const ranked of rankByComplexity(graph, { threshold })) {
    suggestions.push({
      kind: 'high-complexity',
      description: `${ranked.label} has cyclomatic complexity ${ranked.complexity} — consider breaking it up`,
      files: [ranked.file],
    });
  }

  for (const group of detectDuplicates(graph)) {
    suggestions.push({
      kind: 'duplication',
      description: `${group.nodes.length} structurally identical functions — consider extracting a shared implementation`,
      files: group.nodes.map(n => n.file),
    });
  }

  // Every other category here is uncapped — pass an unbounded limit so this
  // one doesn't silently truncate the unified feed (detectNearDuplicates
  // defaults to a much smaller cap for its own standalone CLI/MCP surface).
  for (const group of detectNearDuplicates(graph, { limit: Infinity }).groups) {
    const avgPct = Math.round(group.avgSimilarity * 100);
    suggestions.push({
      kind: 'near-duplication',
      description: `${group.nodes.length} structurally near-identical functions (avg ${avgPct}% similar) — consider extracting a shared implementation`,
      files: group.nodes.map(n => n.file),
    });
  }

  for (const unreachable of detectUnreachableFiles(graph)) {
    suggestions.push({
      kind: 'dead-code',
      description: `${unreachable.file} is not imported by any other tracked file — candidate for removal`,
      files: [unreachable.file],
    });
  }

  return suggestions;
}
