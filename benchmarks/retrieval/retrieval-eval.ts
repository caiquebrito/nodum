/**
 * Offline retrieval evaluation — scores the retriever alone against
 * golden-set.json, no LLM in the loop. Run this after any change to
 * packages/mcp/src/smart-context.ts, semantic-search.ts, or embeddings.ts
 * (specs 066-068) to see the actual before/after Recall@k / MRR / nDCG
 * delta, instead of guessing whether a ranking change helped.
 *
 * Two rankers are reported:
 *   - keyword   — `findRelevantNodes`, always available, always deterministic.
 *   - hybrid    — the same keyword+semantic fusion `buildSmartContext` uses
 *                 internally, only run if `--embeddings` is passed (it
 *                 requires downloading and running the local embedding
 *                 model — network on first run, then cached — so it's opt-in
 *                 here and NOT part of the CI-gated retrieval-eval.test.ts,
 *                 which stays deterministic and offline).
 *
 * Usage:
 *   npx tsx benchmarks/retrieval/retrieval-eval.ts
 *   npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings
 */
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateGraph } from '@caiquebrito/nodum-core';
import type { Graph } from '@caiquebrito/nodum-core';
// @ts-expect-error — compiled output, same import shape as context-size.test.ts
import { findRelevantNodes, extractKeywords } from '@caiquebrito/nodum-query/dist/smart-context.js';
import { resolveSelectors, type NodeSelector } from './resolve.js';
import { scoreQuery, aggregateIRMetrics, type QueryMetrics } from './ir-metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, '..', 'projects');

interface GoldenQuery {
  id: string;
  fixture: string;
  query: string;
  relevant: NodeSelector[];
}

async function loadGoldenSet(): Promise<GoldenQuery[]> {
  const raw = await readFile(join(__dirname, 'golden-set.json'), 'utf-8');
  return JSON.parse(raw).queries;
}

async function loadFixtureGraphs(queries: GoldenQuery[]): Promise<Map<string, Graph>> {
  const fixtures = [...new Set(queries.map((q) => q.fixture))];
  const graphs = new Map<string, Graph>();
  for (const fixture of fixtures) {
    const { graph } = await generateGraph(join(PROJECTS_DIR, fixture));
    graphs.set(fixture, graph);
  }
  return graphs;
}

export async function runKeywordEval(
  queries: GoldenQuery[],
  graphs: Map<string, Graph>,
): Promise<QueryMetrics[]> {
  return queries.map((q) => {
    const graph = graphs.get(q.fixture);
    if (!graph) throw new Error(`No graph loaded for fixture "${q.fixture}" (query ${q.id})`);
    const relevant = resolveSelectors(graph, q.relevant);
    const keywords = extractKeywords(q.query);
    const ranked = findRelevantNodes(keywords, graph.nodes, 25).map((n: { id: string }) => n.id);
    return scoreQuery(q.id, ranked, relevant);
  });
}

async function main(): Promise<void> {
  const useEmbeddings = process.argv.includes('--embeddings');

  const queries = await loadGoldenSet();
  const graphs = await loadFixtureGraphs(queries);

  console.log(`\n🔎 Retrieval evaluation — ${queries.length} queries across ${graphs.size} fixtures\n`);

  const keywordResults = await runKeywordEval(queries, graphs);
  printTable('Keyword ranker (findRelevantNodes)', keywordResults);

  if (useEmbeddings) {
    const { runHybridEval } = await import('./hybrid-eval.js');
    const hybridResults = await runHybridEval(queries, graphs);
    printTable('Hybrid ranker (keyword + semantic fusion)', hybridResults);
  } else {
    console.log('(pass --embeddings to also score the hybrid keyword+semantic ranker)\n');
  }
}

function printTable(label: string, results: QueryMetrics[]): void {
  console.log(`--- ${label} ---`);
  for (const r of results) {
    console.log(
      `  ${r.queryId.padEnd(8)} recall@10=${r.recallAt10.toFixed(2)} ` +
        `precision@10=${r.precisionAt10.toFixed(2)} mrr=${r.reciprocalRank.toFixed(2)} ` +
        `ndcg@10=${r.ndcgAt10.toFixed(2)}`,
    );
  }
  const agg = aggregateIRMetrics(results);
  console.log(
    `  AGGREGATE  recall@5=${agg.meanRecallAt5.toFixed(3)} recall@10=${agg.meanRecallAt10.toFixed(3)} ` +
      `precision@10=${agg.meanPrecisionAt10.toFixed(3)} mrr=${agg.mrr.toFixed(3)} ndcg@10=${agg.meanNdcgAt10.toFixed(3)}\n`,
  );
}

// Only run when invoked directly (tsx benchmarks/retrieval/retrieval-eval.ts),
// not when imported by the test suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('❌ Retrieval eval error:', err);
    process.exit(1);
  });
}
