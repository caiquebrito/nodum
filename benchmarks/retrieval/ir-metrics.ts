/**
 * Standard information-retrieval metrics, scored against a labeled set of
 * relevant node ids per query — no LLM involved. This is the layer spec 028
 * left out: `benchmarks/metrics.ts::scoreAccuracy()` scores an LLM's final
 * answer text, which is noisy, costs API budget, and conflates retrieval
 * quality with the model's writing. These functions score the retriever
 * alone, deterministically, so a ranking change (e.g. spec 066's fusion fix)
 * can be validated for free and in CI, before it's ever worth spending an
 * API call to check the downstream answer.
 *
 * All functions take `ranked` (node ids in the order the retriever returned
 * them, best first) and `relevant` (the labeled relevant-id set for that
 * query) and are pure — no I/O, no async.
 */

/** Fraction of relevant ids that appear anywhere in the top k ranked ids. */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1; // vacuously satisfied — nothing to find
  const top = new Set(ranked.slice(0, k));
  let found = 0;
  for (const id of relevant) {
    if (top.has(id)) found++;
  }
  return found / relevant.size;
}

/** Fraction of the top k ranked ids that are actually relevant. */
export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  const hits = top.filter((id) => relevant.has(id)).length;
  return hits / top.length;
}

/**
 * Mean Reciprocal Rank for a single query: 1 / (rank of the first relevant
 * hit), 0 if none appears anywhere in `ranked`. Callers average this across
 * queries to get the usual "MRR" summary statistic — kept as a per-query
 * function here so `retrieval-eval.ts` can report it per query too.
 */
export function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Normalized Discounted Cumulative Gain at k, with binary relevance (a node
 * is either in the labeled relevant set or not — the golden set has no
 * graded relevance). DCG discounts hits by log2(rank+1) so a relevant node
 * ranked #1 counts more than the same node ranked #10; normalizing by the
 * ideal DCG (all relevant nodes ranked first) bounds the result to [0, 1]
 * regardless of how many relevant nodes exist for the query.
 */
export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1;

  const top = ranked.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) {
      dcg += 1 / Math.log2(i + 2); // i is 0-indexed, rank is i+1, so log2(rank+1)
    }
  }

  const idealHits = Math.min(relevant.size, k);
  let idealDcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idealDcg += 1 / Math.log2(i + 2);
  }

  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

export interface QueryMetrics {
  queryId: string;
  recallAt5: number;
  recallAt10: number;
  precisionAt5: number;
  precisionAt10: number;
  reciprocalRank: number;
  ndcgAt10: number;
}

/** Scores one query's ranked result list against its labeled relevant set. */
export function scoreQuery(queryId: string, ranked: string[], relevant: Set<string>): QueryMetrics {
  return {
    queryId,
    recallAt5: recallAtK(ranked, relevant, 5),
    recallAt10: recallAtK(ranked, relevant, 10),
    precisionAt5: precisionAtK(ranked, relevant, 5),
    precisionAt10: precisionAtK(ranked, relevant, 10),
    reciprocalRank: reciprocalRank(ranked, relevant),
    ndcgAt10: ndcgAtK(ranked, relevant, 10),
  };
}

export interface AggregateIRMetrics {
  queriesScored: number;
  meanRecallAt5: number;
  meanRecallAt10: number;
  meanPrecisionAt5: number;
  meanPrecisionAt10: number;
  mrr: number;
  meanNdcgAt10: number;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Averages per-query metrics into the summary numbers a regression gate checks. */
export function aggregateIRMetrics(perQuery: QueryMetrics[]): AggregateIRMetrics {
  return {
    queriesScored: perQuery.length,
    meanRecallAt5: mean(perQuery.map((q) => q.recallAt5)),
    meanRecallAt10: mean(perQuery.map((q) => q.recallAt10)),
    meanPrecisionAt5: mean(perQuery.map((q) => q.precisionAt5)),
    meanPrecisionAt10: mean(perQuery.map((q) => q.precisionAt10)),
    mrr: mean(perQuery.map((q) => q.reciprocalRank)),
    meanNdcgAt10: mean(perQuery.map((q) => q.ndcgAt10)),
  };
}
