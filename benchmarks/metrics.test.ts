import { describe, it, expect } from 'vitest';
import { scoreAccuracy, aggregateResults, summarizeAccuracyRuns } from './metrics.js';
import type { BenchmarkQuestion, QuestionResult } from './datasets/schema.js';

const expectedElements: BenchmarkQuestion['expectedElements'] = {
  functions: ['login', 'logout'],
};

describe('scoreAccuracy', () => {
  it('returns 100 when there are no expected elements, regardless of length', () => {
    expect(scoreAccuracy('a short response', {})).toBe(100);
    expect(scoreAccuracy('a '.repeat(500), {})).toBe(100);
  });

  it('scores a concise response containing every expected element near 100', () => {
    const response = 'Call login() to authenticate, then logout() to end the session.';
    expect(scoreAccuracy(response, expectedElements)).toBeGreaterThan(90);
  });

  it('scores a padded response with the same recall lower than a concise one', () => {
    const concise = 'Call login() to authenticate, then logout() to end the session.';
    const padded =
      'Call login() to authenticate, then logout() to end the session. ' +
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(60);

    const conciseScore = scoreAccuracy(concise, expectedElements);
    const paddedScore = scoreAccuracy(padded, expectedElements);

    expect(paddedScore).toBeLessThan(conciseScore);
  });

  it('scores a response missing every expected element as 0', () => {
    expect(scoreAccuracy('nothing relevant here', expectedElements)).toBe(0);
  });
});

describe('aggregateResults', () => {
  function result(tokenReduction: number): QuestionResult {
    return {
      question: {} as BenchmarkQuestion,
      baseline: { tokensUsed: 1000, inputTokens: 800, outputTokens: 200, latencyMs: 500, response: '', accuracy: 80 },
      withGraph: { tokensUsed: 400, inputTokens: 300, outputTokens: 100, latencyMs: 300, response: '', accuracy: 90 },
      improvement: {
        tokenReduction,
        inputTokenReduction: 60,
        outputTokenReduction: 50,
        latencyImprovement: 40,
        accuracyGain: 10,
      },
    };
  }

  it('averages improvement metrics across results', () => {
    const summary = aggregateResults([result(60), result(40)]);
    expect(summary.avgTokenReduction).toBe(50);
    expect(summary.questionsRun).toBe(2);
    expect(summary.tokensSaved).toBe((1000 - 400) * 2);
  });

  it('buckets results by whether the graph helped, hurt, or was neutral', () => {
    const summary = aggregateResults([result(60), result(0), result(-50)]);
    expect(summary.questionsWhereGraphHelped).toBe(1);
    expect(summary.questionsWhereGraphWasNeutral).toBe(1);
    expect(summary.questionsWhereGraphHurt).toBe(1);
  });

  it('computes tokensPerCorrectAnswer from the with-graph condition', () => {
    // Two questions, each 90% accurate with graph, 400 tokens each with graph
    // -> totalCorrectCredit = 1.8, totalWithGraphTokens = 800 -> 800/1.8
    const summary = aggregateResults([result(60), result(60)]);
    expect(summary.tokensPerCorrectAnswer).toBeCloseTo(800 / 1.8);
  });

  it('reports Infinity for tokensPerCorrectAnswer when no question earned any accuracy credit', () => {
    const zeroAccuracy: QuestionResult = {
      question: {} as BenchmarkQuestion,
      baseline: { tokensUsed: 1000, inputTokens: 800, outputTokens: 200, latencyMs: 500, response: '', accuracy: 0 },
      withGraph: { tokensUsed: 400, inputTokens: 300, outputTokens: 100, latencyMs: 300, response: '', accuracy: 0 },
      improvement: { tokenReduction: 60, inputTokenReduction: 60, outputTokenReduction: 50, latencyImprovement: 40, accuracyGain: 0 },
    };
    const summary = aggregateResults([zeroAccuracy]);
    expect(summary.tokensPerCorrectAnswer).toBe(Infinity);
  });

  it('does not report a stderr for tokensPerCorrectAnswer when no question carries per-run variance', () => {
    const summary = aggregateResults([result(60), result(40)]);
    expect(summary.tokensPerCorrectAnswerStdErr).toBeUndefined();
  });

  it('propagates a nonzero tokensPerCorrectAnswerStdErr when questions carry accuracyStdErr', () => {
    const withVariance: QuestionResult = {
      ...result(60),
      withGraph: { tokensUsed: 400, inputTokens: 300, outputTokens: 100, latencyMs: 300, response: '', accuracy: 90, accuracyStdErr: 5 },
    };
    const summary = aggregateResults([withVariance]);
    expect(summary.tokensPerCorrectAnswerStdErr).toBeGreaterThan(0);
  });
});

describe('summarizeAccuracyRuns', () => {
  it('averages accuracy scores across runs', () => {
    const { mean } = summarizeAccuracyRuns([80, 90, 100]);
    expect(mean).toBe(90);
  });

  it('reports zero stderr for a single run (nothing to measure spread from)', () => {
    const { stdErr } = summarizeAccuracyRuns([85]);
    expect(stdErr).toBe(0);
  });

  it('reports a nonzero stderr when runs disagree', () => {
    const { stdErr } = summarizeAccuracyRuns([50, 100]);
    expect(stdErr).toBeGreaterThan(0);
  });

  it('reports zero stderr when every run agrees exactly', () => {
    const { stdErr } = summarizeAccuracyRuns([75, 75, 75]);
    expect(stdErr).toBe(0);
  });
});
