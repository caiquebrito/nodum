import type { Graph } from '../types.js';
import { detectDuplicates } from './duplication.js';
import { estimateSimilarity } from '../parser/similarity-signature.js';

/**
 * Chosen from real-corpus calibration during spec 048, not merely
 * asserted — see that spec's Success Metrics for the full precision table.
 * Two real checks:
 *  - Swept 0.5-0.9 against ~370 real cross-language/cross-file node pairs
 *    (nodum's own codebase): zero false positives observed even down to
 *    0.5 (every matched pair at every threshold inspected was a real
 *    structural similarity — e.g. the 8 language parsers' near-identical
 *    `parse()`/`visit()` shapes, duplicated test-mock helpers, sibling CLI
 *    commands).
 *  - A polyglot near-duplicate fixture (the same function with one branch
 *    added, hand-written in all 8 languages) estimated similarity in a
 *    0.688-1.0 band depending on language — the estimator's real per-
 *    language variance, driven by each grammar's own token-vocabulary
 *    shape. A 0.7 default would miss this exact recall target in the
 *    lowest-scoring language (TypeScript, 0.688) despite it being a
 *    genuine near-duplicate every other language caught.
 * 0.65 sits below that polyglot recall floor while staying meaningfully
 * above the 0.5 point where the real-corpus sweep still showed zero false
 * positives — a safety margin, not the noise floor itself. Lowering it
 * further if warranted is a non-breaking change.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.65;
export const DEFAULT_SIMILAR_CODE_LIMIT = 20;

export interface SimilarCodeMatch {
  nodeId: string;
  label: string;
  file: string;
  /** 1 for an exact `duplicateHash` match; the MinHash-estimated Jaccard similarity otherwise. */
  similarity: number;
  kind: 'exact' | 'fuzzy';
}

export interface SimilarCodeOptions {
  /** Minimum estimated similarity for a fuzzy match (spec 048). Exact matches are always included regardless. */
  threshold?: number;
  limit?: number;
}

export interface SimilarCodeResult {
  nodeId: string;
  threshold: number;
  matches: SimilarCodeMatch[];
}

/**
 * Finds other nodes structurally near-identical to `nodeId` — the union of
 * two mechanisms, exact taking precedence over fuzzy:
 *
 *  1. **Exact** (spec 015, unchanged): every other node sharing `nodeId`'s
 *     `duplicateHash`, via the same `detectDuplicates` grouping
 *     `analyzer/duplication.ts` and `suggest-refactoring.ts` still use
 *     directly and unmodified.
 *  2. **Fuzzy** (spec 048): every other node (not already matched exactly)
 *     whose `similaritySignature` estimates a Jaccard similarity of at
 *     least `threshold` against `nodeId`'s.
 *
 * The union-with-exact-precedence shape is load-bearing for backward
 * compatibility, not just a design nicety: `similaritySignature`'s
 * token-count floor is strictly higher than `duplicateHash`'s (see
 * `similarity-signature.ts`), so a shortish body can have an exact hash
 * with no fuzzy signature at all. A fuzzy-only implementation would
 * silently *lose* matches this function already found before spec 048 —
 * the union prevents that by construction, verified by a dedicated
 * regression test.
 */
export function findSimilarCode(graph: Graph, nodeId: string, options: SimilarCodeOptions = {}): SimilarCodeResult {
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const limit = options.limit ?? DEFAULT_SIMILAR_CODE_LIMIT;

  const self = graph.nodes.find(n => n.id === nodeId);
  if (!self) return { nodeId, threshold, matches: [] };

  const matched = new Map<string, SimilarCodeMatch>();

  if (self.duplicateHash) {
    const groups = detectDuplicates(graph);
    const group = groups.find(g => g.nodes.some(n => n.nodeId === nodeId));
    if (group) {
      for (const n of group.nodes) {
        if (n.nodeId === nodeId) continue;
        matched.set(n.nodeId, { nodeId: n.nodeId, label: n.label, file: n.file, similarity: 1, kind: 'exact' });
      }
    }
  }

  if (self.similaritySignature) {
    for (const n of graph.nodes) {
      if (n.id === nodeId || matched.has(n.id) || !n.similaritySignature) continue;
      const similarity = estimateSimilarity(self.similaritySignature, n.similaritySignature);
      if (similarity >= threshold) {
        matched.set(n.id, { nodeId: n.id, label: n.label, file: n.file, similarity, kind: 'fuzzy' });
      }
    }
  }

  const matches = [...matched.values()]
    .sort((a, b) => b.similarity - a.similarity || a.nodeId.localeCompare(b.nodeId))
    .slice(0, limit);

  return { nodeId, threshold, matches };
}
