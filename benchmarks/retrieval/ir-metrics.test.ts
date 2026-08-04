import { describe, it, expect } from 'vitest';
import { recallAtK, precisionAtK, reciprocalRank, ndcgAtK, aggregateIRMetrics, scoreQuery } from './ir-metrics.js';

describe('recallAtK', () => {
  it('is 1 when every relevant id appears in the top k', () => {
    expect(recallAtK(['a', 'b', 'c'], new Set(['a', 'c']), 3)).toBe(1);
  });

  it('is a fraction when only some relevant ids appear', () => {
    expect(recallAtK(['a', 'x', 'y'], new Set(['a', 'b']), 3)).toBe(0.5);
  });

  it('ignores relevant ids ranked past k', () => {
    expect(recallAtK(['x', 'y', 'a'], new Set(['a']), 2)).toBe(0);
  });

  it('is vacuously 1 when there is nothing relevant to find', () => {
    expect(recallAtK(['a', 'b'], new Set(), 5)).toBe(1);
  });
});

describe('precisionAtK', () => {
  it('scores the fraction of the top k that are relevant', () => {
    expect(precisionAtK(['a', 'b', 'c', 'd'], new Set(['a', 'c']), 4)).toBe(0.5);
  });

  it('is 0 for an empty ranked list', () => {
    expect(precisionAtK([], new Set(['a']), 5)).toBe(0);
  });

  it('only looks at the top k, not the full ranked list', () => {
    expect(precisionAtK(['a', 'x', 'x', 'x'], new Set(['a']), 1)).toBe(1);
  });
});

describe('reciprocalRank', () => {
  it('is 1 when the first result is relevant', () => {
    expect(reciprocalRank(['a', 'b'], new Set(['a']))).toBe(1);
  });

  it('is 1/rank for the first relevant hit', () => {
    expect(reciprocalRank(['x', 'y', 'a'], new Set(['a']))).toBeCloseTo(1 / 3);
  });

  it('is 0 when no relevant id appears anywhere', () => {
    expect(reciprocalRank(['x', 'y'], new Set(['a']))).toBe(0);
  });
});

describe('ndcgAtK', () => {
  it('is 1 for a perfect ranking (all relevant ids first)', () => {
    expect(ndcgAtK(['a', 'b', 'x', 'y'], new Set(['a', 'b']), 4)).toBeCloseTo(1);
  });

  it('penalizes relevant ids ranked lower', () => {
    const perfect = ndcgAtK(['a', 'b', 'x'], new Set(['a', 'b']), 3);
    const worse = ndcgAtK(['x', 'a', 'b'], new Set(['a', 'b']), 3);
    expect(worse).toBeLessThan(perfect);
  });

  it('is 0 when nothing relevant appears in the top k', () => {
    expect(ndcgAtK(['x', 'y'], new Set(['a']), 2)).toBe(0);
  });

  it('is vacuously 1 when there is nothing relevant to find', () => {
    expect(ndcgAtK(['a', 'b'], new Set(), 5)).toBe(1);
  });
});

describe('scoreQuery / aggregateIRMetrics', () => {
  it('averages per-query metrics correctly across queries', () => {
    const q1 = scoreQuery('q1', ['a', 'b'], new Set(['a']));
    const q2 = scoreQuery('q2', ['x', 'y'], new Set(['y']));
    const agg = aggregateIRMetrics([q1, q2]);

    expect(agg.queriesScored).toBe(2);
    // q1: relevant at rank 1 -> RR 1; q2: relevant at rank 2 -> RR 0.5
    expect(agg.mrr).toBeCloseTo((1 + 0.5) / 2);
  });

  it('returns all-zero aggregates for an empty result set without dividing by zero', () => {
    const agg = aggregateIRMetrics([]);
    expect(agg.queriesScored).toBe(0);
    expect(agg.mrr).toBe(0);
    expect(agg.meanRecallAt10).toBe(0);
  });
});
