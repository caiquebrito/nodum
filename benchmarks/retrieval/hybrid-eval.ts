/**
 * The embeddings-dependent half of retrieval-eval.ts, split into its own
 * module so a plain `npx tsx retrieval-eval.ts` (and the CI-gated
 * retrieval-eval.test.ts) never pays for loading @xenova/transformers or
 * downloading the local embedding model. Only imported when `--embeddings`
 * is passed.
 *
 * Mirrors the seed-selection logic `buildSmartContext` runs internally
 * (packages/mcp/src/smart-context.ts) — hybrid fusion of keyword rank and
 * semantic cosine similarity — so this measures exactly what a real query
 * would rank, without pulling in buildSmartContext's caching/expansion/
 * formatting, which aren't part of what these IR metrics score.
 */
import type { Graph } from '@caiquebrito/nodum-core';
// @ts-expect-error — compiled output
import { findRelevantNodes, extractKeywords } from '@caiquebrito/nodum-mcp/dist/smart-context.js';
// @ts-expect-error — compiled output
import { semanticScoreNodes, mergeScores, getTopScoredNodes } from '@caiquebrito/nodum-mcp/dist/semantic-search.js';
// @ts-expect-error — compiled output
import { generateGraphEmbeddings, generateQueryEmbedding } from '@caiquebrito/nodum-mcp/dist/embeddings.js';
import { resolveSelectors, type NodeSelector } from './resolve.js';
import { scoreQuery, type QueryMetrics } from './ir-metrics.js';

interface GoldenQuery {
  id: string;
  fixture: string;
  query: string;
  relevant: NodeSelector[];
}

export async function runHybridEval(
  queries: GoldenQuery[],
  graphs: Map<string, Graph>,
): Promise<QueryMetrics[]> {
  // Embed every fixture graph's nodes once, up front.
  for (const graph of graphs.values()) {
    await generateGraphEmbeddings(graph.nodes as any);
  }

  const results: QueryMetrics[] = [];
  for (const q of queries) {
    const graph = graphs.get(q.fixture);
    if (!graph) throw new Error(`No graph loaded for fixture "${q.fixture}" (query ${q.id})`);
    const relevant = resolveSelectors(graph, q.relevant);

    const keywords = extractKeywords(q.query);
    const keywordResults = findRelevantNodes(keywords, graph.nodes, 40) as { id: string }[];
    const keywordScoreMap = new Map(keywordResults.map((n, idx) => [n.id, 40 - idx]));

    const queryEmbedding = await generateQueryEmbedding(q.query);
    const semanticResults = semanticScoreNodes(queryEmbedding, graph.nodes as any);
    semanticResults.forEach((s: any) => {
      s.keywordScore = keywordScoreMap.get(s.node.id) || 0;
    });
    const merged = mergeScores(semanticResults, 0.4, 0.6);
    const ranked = getTopScoredNodes(merged, 25).map((n: any) => n.id);

    results.push(scoreQuery(q.id, ranked, relevant));
  }
  return results;
}
