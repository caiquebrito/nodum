import type { Graph } from '../types.js';
import { decodeSimilaritySignature, estimateSimilarityFromLanes } from '../parser/similarity-signature.js';
import { DEFAULT_SIMILARITY_THRESHOLD } from './similar-code.js';

export const DEFAULT_NEAR_DUPLICATE_LIMIT = 20;

export interface NearDuplicateGroupMember {
  nodeId: string;
  label: string;
  file: string;
}

export interface NearDuplicateGroup {
  nodes: NearDuplicateGroupMember[];
  minSimilarity: number;
  avgSimilarity: number;
}

export interface DetectNearDuplicatesOptions {
  /** Minimum estimated pairwise similarity for two nodes to be linked (spec 048's calibrated default). */
  threshold?: number;
  limit?: number;
}

export interface DetectNearDuplicatesResult {
  threshold: number;
  groups: NearDuplicateGroup[];
  /** True when more qualifying groups existed than `limit` allowed — see `limit`'s doc comment. */
  truncated: boolean;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Groups nodes whose `similaritySignature`s are pairwise similar to each
 * other above `threshold` — every member of a group must clear the
 * threshold against *every other* member (a quasi-clique), not merely be
 * transitively reachable through a chain of pairwise-similar neighbors.
 *
 * This was NOT the first design: an earlier version used single-linkage
 * transitive closure (union-find — A~B~C groups if A~B and B~C, even if
 * A~C alone is below threshold), reasoning that it matched "these are all
 * near-duplicates of each other." Real end-to-end verification against a
 * large real project (spec 052) proved that reasoning wrong: single-linkage
 * chaining merged **7,607 real, mostly-unrelated functions** (an Activity's
 * `onCreate`, a ViewModel test assertion, ...) into one meaningless group —
 * over 13% of the project's scored nodes — purely by each pair separately
 * clearing a lenient-enough threshold somewhere along a long chain. A
 * genuine near-duplicate cluster should mean every member actually
 * resembles every other member, which single-linkage does not guarantee at
 * any real project's scale.
 *
 * Exact maximum-clique cover is NP-hard, so this uses a greedy
 * quasi-clique approximation instead: process candidates in a fixed order
 * (node array order, so results are deterministic); each unassigned node
 * seeds a new group, and its unassigned neighbors are added to that group
 * greedily (highest similarity to the seed first) only if the candidate
 * clears `threshold` against *every* node already in the group, not just
 * the seed. This is order-dependent (a different starting order can
 * produce a different, equally valid, quasi-clique cover) but never
 * produces a group with an internal pair below `threshold` — the property
 * the earlier design was missing.
 *
 * Fully additive alongside `duplication.ts`'s exact-hash `detectDuplicates` —
 * no consumer of `DuplicateGroup` reads its `.hash` field (verified during
 * this spec's research), so there was no reason to touch or extend that
 * type. This is a separate analyzer output over the fuzzy `similaritySignature`
 * field instead, reusing spec 048's existing calibrated threshold/signature
 * format as-is.
 *
 * Every signature is decoded once up front into a typed array (the real
 * perf lever — `estimateSimilarity`'s per-call hex-parsing is the actual
 * hazard, not the O(n²) pair count itself). Measured at real scale (spec
 * 052): ~15,830 real function/method signatures full-pairwise-compare plus
 * quasi-clique grouping in well under 10 seconds, with no LSH banding
 * needed.
 */
export function detectNearDuplicates(graph: Graph, options: DetectNearDuplicatesOptions = {}): DetectNearDuplicatesResult {
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const limit = options.limit ?? DEFAULT_NEAR_DUPLICATE_LIMIT;

  const candidates = graph.nodes.filter(n => n.similaritySignature);
  const lanes = candidates.map(n => decodeSimilaritySignature(n.similaritySignature!));

  const adjacency: Set<number>[] = Array.from({ length: candidates.length }, () => new Set());
  const pairSimilarities = new Map<string, number>();

  for (let i = 0; i < candidates.length; i++) {
    const lanesI = lanes[i];
    if (!lanesI) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const lanesJ = lanes[j];
      if (!lanesJ) continue;
      const similarity = estimateSimilarityFromLanes(lanesI, lanesJ);
      if (similarity >= threshold) {
        adjacency[i].add(j);
        adjacency[j].add(i);
        pairSimilarities.set(pairKey(i, j), similarity);
      }
    }
  }

  const assigned = new Array<boolean>(candidates.length).fill(false);
  const groups: NearDuplicateGroup[] = [];

  for (let seed = 0; seed < candidates.length; seed++) {
    if (assigned[seed] || adjacency[seed].size === 0) continue;

    const group = [seed];
    assigned[seed] = true;

    const pool = [...adjacency[seed]]
      .filter(j => !assigned[j])
      .sort((a, b) => (pairSimilarities.get(pairKey(seed, b)) ?? 0) - (pairSimilarities.get(pairKey(seed, a)) ?? 0) || a - b);

    for (const candidate of pool) {
      if (assigned[candidate]) continue;
      if (group.every(member => adjacency[member].has(candidate))) {
        group.push(candidate);
        assigned[candidate] = true;
      }
    }

    if (group.length < 2) continue;

    let minSimilarity = Infinity;
    let sum = 0;
    let pairCount = 0;
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const similarity = pairSimilarities.get(pairKey(group[a], group[b]))!;
        if (similarity < minSimilarity) minSimilarity = similarity;
        sum += similarity;
        pairCount++;
      }
    }

    groups.push({
      nodes: group
        .map(i => candidates[i])
        .map(n => ({ nodeId: n.id, label: n.label, file: n.file }))
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      minSimilarity,
      avgSimilarity: sum / pairCount,
    });
  }

  groups.sort((a, b) => b.nodes.length - a.nodes.length || b.avgSimilarity - a.avgSimilarity);

  return {
    threshold,
    groups: groups.slice(0, limit),
    truncated: groups.length > limit,
  };
}
