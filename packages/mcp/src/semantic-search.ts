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
 * Returns nodes sorted by semantic relevance
 */
export function semanticScoreNodes(
  queryEmbedding: number[],
  nodes: BasicNode[]
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
    .filter(scored => scored.semanticScore > 0)
    .sort((a, b) => b.semanticScore - a.semanticScore);
}

/**
 * Merge keyword and semantic scores with weighted combination
 * finalScore = (keywordWeight * keywordScore) + (semanticWeight * semanticScore)
 */
export function mergeScores(
  scoredNodes: ScoredNode[],
  keywordWeight: number = 0.4,
  semanticWeight: number = 0.6
): ScoredNode[] {
  return scoredNodes.map(scored => ({
    ...scored,
    finalScore:
      keywordWeight * scored.keywordScore +
      semanticWeight * scored.semanticScore,
  }));
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
