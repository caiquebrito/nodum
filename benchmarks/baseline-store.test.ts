import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BenchmarkSummary, StoredBaseline } from './datasets/schema.js';
import { baselineFromSummary, writeBaseline, loadPreviousBaseline, diffAgainstBaseline } from './baseline-store.js';

function summary(tokensPerCorrectAnswer: number): BenchmarkSummary {
  return {
    projectName: 'sample-next-app',
    projectPath: '/tmp/sample-next-app',
    projectStats: { files: 4, functions: 10, classes: 3, interfaces: 3, edges: 12 },
    timestamp: new Date().toISOString(),
    results: [],
    aggregate: {
      avgTokenReduction: 90,
      avgInputTokenReduction: 90,
      avgOutputTokenReduction: 80,
      avgLatencyImprovement: 50,
      avgAccuracyGain: 5,
      totalBaselineTokens: 10000,
      totalWithGraphTokens: 1000,
      tokensSaved: 9000,
      questionsRun: 15,
      questionsWhereGraphHelped: 12,
      questionsWhereGraphWasNeutral: 2,
      questionsWhereGraphHurt: 1,
      tokensPerCorrectAnswer,
    },
  };
}

describe('baseline-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodum-baselines-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back a baseline for a version', async () => {
    const baseline = baselineFromSummary(summary(100), '2.18.0');
    await writeBaseline(baseline, dir);

    const loaded = await loadPreviousBaseline('2.19.0', dir);
    expect(loaded?.nodumVersion).toBe('2.18.0');
    expect(loaded?.aggregate.tokensPerCorrectAnswer).toBe(100);
  });

  it('returns null when no baseline directory exists yet', async () => {
    const loaded = await loadPreviousBaseline('2.18.0', join(dir, 'does-not-exist'));
    expect(loaded).toBeNull();
  });

  it('returns null when every stored baseline is not older than the current version', async () => {
    await writeBaseline(baselineFromSummary(summary(100), '2.18.0'), dir);
    const loaded = await loadPreviousBaseline('2.18.0', dir); // same version, not strictly older
    expect(loaded).toBeNull();
  });

  it('picks the highest version strictly less than current when multiple baselines exist', async () => {
    await writeBaseline(baselineFromSummary(summary(200), '2.16.0'), dir);
    await writeBaseline(baselineFromSummary(summary(150), '2.17.0'), dir);
    await writeBaseline(baselineFromSummary(summary(999), '2.19.0'), dir); // newer than current — must be skipped

    const loaded = await loadPreviousBaseline('2.18.0', dir);
    expect(loaded?.nodumVersion).toBe('2.17.0');
  });

  it('computes a negative delta (improvement) when tokensPerCorrectAnswer dropped', () => {
    const previous: StoredBaseline = baselineFromSummary(summary(200), '2.17.0');
    const current = summary(100);

    const delta = diffAgainstBaseline(current, previous);
    expect(delta.previousVersion).toBe('2.17.0');
    expect(delta.tokensPerCorrectAnswerDelta).toBe(-100);
    expect(delta.tokensPerCorrectAnswerPercentChange).toBeCloseTo(-50);
  });

  it('computes a positive delta (regression) when tokensPerCorrectAnswer rose', () => {
    const previous: StoredBaseline = baselineFromSummary(summary(100), '2.17.0');
    const current = summary(150);

    const delta = diffAgainstBaseline(current, previous);
    expect(delta.tokensPerCorrectAnswerDelta).toBe(50);
    expect(delta.tokensPerCorrectAnswerPercentChange).toBeCloseTo(50);
  });
});
