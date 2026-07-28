import { describe, it, expect } from 'vitest';
import { scoreAccuracy, aggregateResults } from './metrics.js';
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
});
