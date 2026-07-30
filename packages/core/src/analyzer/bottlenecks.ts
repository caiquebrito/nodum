import type { Graph } from '../types.js';
import { rankByComplexity } from './complexity.js';
import { traceImpact } from './impact.js';

// Matches suggest-refactoring.ts's own default complexityThreshold — the
// same "worth a human look" cyclomatic-complexity bar used elsewhere in this
// codebase, reused here so "high complexity" means the same thing in both
// reports.
const HIGH_COMPLEXITY_THRESHOLD = 10;

/**
 * `score` alone conflates two independent signals: a foundational,
 * low-complexity shared type (a `Result` monad, a base use-case class) can
 * rank at the top purely from fan-in, despite carrying none of the actual
 * risk ("bottleneck" implies) a genuinely complex chokepoint does. `risk`
 * makes that distinction explicit instead of leaving it to the reader to
 * infer from `maxComplexity`/`dependentCount` themselves:
 *  - `high`: elevated complexity AND depended-upon — a real chokepoint.
 *  - `foundational`: widely depended-upon but simple — expected/healthy for
 *    a shared abstraction, not a risk signal.
 *  - `complex`: elevated complexity but nothing (tracked) depends on it —
 *    worth simplifying, but not a "bottleneck" in the fan-in sense.
 *  - `low`: neither signal elevated.
 */
export type BottleneckRisk = 'high' | 'foundational' | 'complex' | 'low';

export interface Bottleneck {
  fileNodeId: string;
  file: string;
  maxComplexity: number;
  dependentCount: number;
  score: number;
  risk: BottleneckRisk;
}

export interface FindBottlenecksOptions {
  limit?: number;
}

function classifyRisk(maxComplexity: number, dependentCount: number): BottleneckRisk {
  const highComplexity = maxComplexity >= HIGH_COMPLEXITY_THRESHOLD;
  const hasDependents = dependentCount > 0;
  if (highComplexity && hasDependents) return 'high';
  if (hasDependents) return 'foundational';
  if (highComplexity) return 'complex';
  return 'low';
}

/**
 * Ranks files by a composite bottleneck score: how complex their code is
 * (spec 014's rankByComplexity, taking the max per file), combined with how
 * many other files transitively depend on them (spec 016's traceImpact).
 * File granularity only — the graph has no per-function dependency edges to
 * rank on. Files with no scored functions are excluded, not scored as 0.
 *
 * `score` still sorts by fan-in-dominated composite (unchanged, for
 * backward-compat ordering) — `risk` is the field to read before treating a
 * high-ranked entry as something that needs fixing, not just something many
 * files use.
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
      risk: classifyRisk(maxComplexity, dependentCount),
    });
  }

  bottlenecks.sort((a, b) => b.score - a.score);
  return options.limit !== undefined ? bottlenecks.slice(0, options.limit) : bottlenecks;
}
