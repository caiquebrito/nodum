/**
 * Semantic search using embeddings
 * Finds semantically similar nodes instead of just keyword matches
 * v2.0 Phase 2: 20% additional token reduction
 */

interface BasicNode {
  id: string;
  label: string;
  type: string;
  embedding?: number[];
}

interface ScoredNode {
  node: BasicNode;
  semanticScore: number;
  keywordScore: number;
  finalScore: number;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }

  const denominator = Math.sqrt(magnitude1) * Math.sqrt(magnitude2);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Score nodes using semantic similarity to query
 * Returns the top `topK` nodes sorted by semantic relevance.
 *
 * With normalized embeddings (see `embeddings.ts`'s `embed(..., { normalize:
 * true })`), nearly every node has nonzero cosine similarity to any query,
 * so filtering on `score > 0` barely filters anything — it just forces a
 * full-graph sort where a bounded top-K slice does the same job cheaper.
 */
export function semanticScoreNodes(
  queryEmbedding: number[],
  nodes: BasicNode[],
  topK: number = 200
): ScoredNode[] {
  return nodes
    .map(node => {
      const semanticScore = node.embedding
        ? cosineSimilarity(queryEmbedding, node.embedding)
        : 0;

      return {
        node,
        semanticScore,
        keywordScore: 0, // Will be set by caller
        finalScore: 0,   // Will be computed
      };
    })
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, topK);
}

/**
 * Fuse any number of ranked node-id lists via Reciprocal Rank Fusion (RRF):
 *
 *   score(node) = Σ_ranker  weight_r / (k + rank_r(node))
 *
 * `rank_r(node)` is the node's 1-based position within ranker `r`'s list.
 * A node absent from a ranker's list contributes 0 from that ranker (it is
 * "unranked" there, not "rank 0") — this is what makes RRF safe to use over
 * rankers whose underlying scores live on incomparable scales (e.g. a 0-40
 * keyword rank vs. a 0-1 cosine similarity): only rank position matters, not
 * the raw score magnitude. `k = 60` is the conventional RRF constant, which
 * dampens the impact of rank-1 dominance without per-corpus tuning.
 */
export function fuseByRRF(
  rankedLists: { nodeIds: string[]; weight: number }[],
  k: number = 60
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const { nodeIds, weight } of rankedLists) {
    nodeIds.forEach((nodeId, idx) => {
      const rank = idx + 1; // 1-based rank
      const contribution = weight / (k + rank);
      scores.set(nodeId, (scores.get(nodeId) ?? 0) + contribution);
    });
  }

  return scores;
}

/**
 * Merge keyword and semantic rankings into a single fused ranking via RRF
 * (see `fuseByRRF`). Replaces the old scale-mismatched weighted sum of raw
 * keyword-rank and cosine-similarity values (spec 066).
 *
 * `semanticResults` must already be sorted descending by `semanticScore`
 * (as returned by `semanticScoreNodes`); `keywordResults` must already be
 * sorted by keyword relevance (as returned by `findRelevantNodes`) — both
 * rankers' rank positions, not their raw scores, drive the fused order.
 */
export function mergeScores(
  semanticResults: ScoredNode[],
  keywordResults: BasicNode[],
  keywordWeight: number = 0.4,
  semanticWeight: number = 0.6,
  k: number = 60
): ScoredNode[] {
  const nodeById = new Map<string, BasicNode>();
  const semanticScoreById = new Map<string, number>();

  for (const scored of semanticResults) {
    nodeById.set(scored.node.id, scored.node);
    semanticScoreById.set(scored.node.id, scored.semanticScore);
  }
  for (const node of keywordResults) {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  }

  const rrfScores = fuseByRRF(
    [
      { nodeIds: keywordResults.map(n => n.id), weight: keywordWeight },
      { nodeIds: semanticResults.map(s => s.node.id), weight: semanticWeight },
    ],
    k
  );

  const fused: ScoredNode[] = [];
  for (const [nodeId, finalScore] of rrfScores.entries()) {
    const node = nodeById.get(nodeId);
    if (!node) continue; // should be unreachable: every fused id came from one of the two node maps above
    fused.push({
      node,
      semanticScore: semanticScoreById.get(nodeId) ?? 0,
      keywordScore: 0,
      finalScore,
    });
  }
  return fused;
}

/**
 * Find top-K nodes by combined semantic + keyword score
 */
export function getTopScoredNodes(
  scoredNodes: ScoredNode[],
  topK: number
): BasicNode[] {
  return scoredNodes
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, topK)
    .map(scored => scored.node);
}

/**
 * Expand search results with semantic neighbors
 * If not enough nodes found, find similar ones to the results
 */
export function findSemanticNeighbors(
  results: BasicNode[],
  allNodes: BasicNode[],
  targetCount: number
): BasicNode[] {
  if (results.length >= targetCount) {
    return results.slice(0, targetCount);
  }

  // Extend with semantically similar nodes to our results
  const resultEmbeddings = results
    .filter(n => n.embedding)
    .map(n => n.embedding!);

  if (resultEmbeddings.length === 0) {
    return results;
  }

  // Average embedding of results
  const avgEmbedding = averageEmbeddings(resultEmbeddings);

  const otherNodes = allNodes.filter(
    n => !results.some(r => r.id === n.id)
  );

  const similar = otherNodes
    .filter(n => n.embedding)
    .map(n => ({
      node: n,
      score: cosineSimilarity(avgEmbedding, n.embedding!),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount - results.length)
    .map(s => s.node);

  return [...results, ...similar];
}

/**
 * Compute average of multiple embeddings
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];

  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    avg[i] /= embeddings.length;
  }

  return avg;
}
