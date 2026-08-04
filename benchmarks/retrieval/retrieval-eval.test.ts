import { describe, it, expect, beforeAll } from 'vitest';
import { generateGraph } from '@caiquebrito/nodum-core';
import type { Graph } from '@caiquebrito/nodum-core';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { aggregateIRMetrics } from './ir-metrics.js';
import { runKeywordEval } from './retrieval-eval.js';

/**
 * Deterministic, offline regression gate for retrieval quality — same
 * posture as ../context-size.test.ts's token ceilings (spec 027): a cheap
 * assertion that runs on every PR, guarding a property the nightly,
 * API-spending benchmark (benchmarks/harness.ts) can only observe
 * expensively and non-deterministically.
 *
 * Scores the keyword ranker only (`findRelevantNodes`), not the hybrid
 * keyword+semantic one — the hybrid path needs the local embedding model,
 * which means a network fetch on first run; see retrieval-eval.ts's module
 * doc for why that's opt-in (`--embeddings`) rather than part of this gate.
 * Run `npx tsx benchmarks/retrieval/retrieval-eval.ts --embeddings` locally
 * to check the hybrid ranker.
 *
 * Floors below are the actual measured aggregate from the golden set as of
 * spec 063 (26 queries across the two fixtures under benchmarks/projects/),
 * with a small margin. If a legitimate change to smart-context.ts's keyword
 * scoring moves these numbers, update the floor deliberately and record the
 * before/after in that spec's Success Metrics section — don't lower it
 * silently to make a regression pass. If a change RAISES these numbers,
 * raise the floor too, so future regressions are still caught.
 */
const RECALL_AT_10_FLOOR = 0.9;
const NDCG_AT_10_FLOOR = 0.75;
const MRR_FLOOR = 0.7;

const __dirname = dirname(fileURLToPath(import.meta.url));

interface NodeSelector {
  file: string;
  label: string;
  type: string;
}

interface GoldenQuery {
  id: string;
  fixture: string;
  query: string;
  relevant: NodeSelector[];
}

let queries: GoldenQuery[];
let graphs: Map<string, Graph>;

beforeAll(async () => {
  const raw = await readFile(join(__dirname, 'golden-set.json'), 'utf-8');
  queries = JSON.parse(raw).queries;

  const fixtures = [...new Set(queries.map((q) => q.fixture))];
  graphs = new Map();
  for (const fixture of fixtures) {
    const { graph } = await generateGraph(join(__dirname, '..', 'projects', fixture));
    graphs.set(fixture, graph);
  }
}, 30_000);

describe('keyword retrieval quality (golden set regression gate)', () => {
  it('meets the recall@10 / nDCG@10 / MRR floor across the golden set', async () => {
    const results = await runKeywordEval(queries, graphs);
    const agg = aggregateIRMetrics(results);

    expect(agg.queriesScored).toBe(queries.length);
    expect(agg.meanRecallAt10).toBeGreaterThanOrEqual(RECALL_AT_10_FLOOR);
    expect(agg.meanNdcgAt10).toBeGreaterThanOrEqual(NDCG_AT_10_FLOOR);
    expect(agg.mrr).toBeGreaterThanOrEqual(MRR_FLOOR);
  });
});
