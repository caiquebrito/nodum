import type { BenchmarkQuestion, BenchmarkSummary, QuestionResult } from './datasets/schema.js';

// A response mentioning every expected element in ~150 words is treated as
// maximally precise; padding well past that for the same recall is
// penalized. This is a length-based proxy, not true precision — the
// dataset has no ground truth for *incorrect* claims a response could make,
// so there's nothing to check false positives against. Named and
// documented as a proxy rather than asserted as real precision, matching
// the rest of this release's stance on not overstating what's measured.
const IDEAL_WORDS_PER_EXPECTED_ELEMENT = 150;

export function scoreAccuracy(
  response: string,
  expectedElements: BenchmarkQuestion['expectedElements'],
): number {
  let found = 0;
  let total = 0;
  const lowerResponse = response.toLowerCase();

  // Check functions
  if (expectedElements.functions) {
    for (const fn of expectedElements.functions) {
      total++;
      if (lowerResponse.includes(fn.toLowerCase())) {
        found++;
      }
    }
  }

  // Check files
  if (expectedElements.files) {
    for (const file of expectedElements.files) {
      total++;
      if (lowerResponse.includes(file) || lowerResponse.includes(file.replace(/\//g, '/'))) {
        found++;
      }
    }
  }

  // Check classes
  if (expectedElements.classes) {
    for (const cls of expectedElements.classes) {
      total++;
      // Look for class name as word boundary
      const regex = new RegExp(`\\b${cls}\\b`, 'i');
      if (regex.test(response)) {
        found++;
      }
    }
  }

  // Check concepts
  if (expectedElements.conceptsMentioned) {
    for (const concept of expectedElements.conceptsMentioned) {
      total++;
      const regex = new RegExp(`\\b${concept}\\b`, 'i');
      if (regex.test(response)) {
        found++;
      }
    }
  }

  if (total === 0) return 100; // If no expected elements, consider it a pass

  const recall = found / total;
  const wordCount = response.split(/\s+/).filter(Boolean).length;
  const idealWordCount = total * IDEAL_WORDS_PER_EXPECTED_ELEMENT;
  const precision = Math.min(1, idealWordCount / Math.max(wordCount, 1));

  // Harmonic mean (F1) — a response only scores well if it's both complete
  // AND reasonably concise, not just long enough to accidentally contain
  // every expected keyword.
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return f1 * 100;
}

export function aggregateResults(results: QuestionResult[]): BenchmarkSummary['aggregate'] {
  const questionsRun = results.length;

  let totalTokenReduction = 0;
  let totalInputTokenReduction = 0;
  let totalOutputTokenReduction = 0;
  let totalLatencyImprovement = 0;
  let totalAccuracyGain = 0;

  let questionsWhereGraphHelped = 0;
  let questionsWhereGraphWasNeutral = 0;
  let questionsWhereGraphHurt = 0;

  let totalBaselineTokens = 0;
  let totalWithGraphTokens = 0;

  for (const result of results) {
    totalTokenReduction += result.improvement.tokenReduction;
    totalInputTokenReduction += result.improvement.inputTokenReduction;
    totalOutputTokenReduction += result.improvement.outputTokenReduction;
    totalLatencyImprovement += result.improvement.latencyImprovement;
    totalAccuracyGain += result.improvement.accuracyGain;

    totalBaselineTokens += result.baseline.tokensUsed;
    totalWithGraphTokens += result.withGraph.tokensUsed;

    if (result.improvement.tokenReduction > 0.1) {
      questionsWhereGraphHelped++;
    } else if (result.improvement.tokenReduction > -0.1) {
      questionsWhereGraphWasNeutral++;
    } else {
      questionsWhereGraphHurt++;
    }
  }

  const tokensSaved = totalBaselineTokens - totalWithGraphTokens;

  return {
    avgTokenReduction: totalTokenReduction / questionsRun,
    avgInputTokenReduction: totalInputTokenReduction / questionsRun,
    avgOutputTokenReduction: totalOutputTokenReduction / questionsRun,
    avgLatencyImprovement: totalLatencyImprovement / questionsRun,
    avgAccuracyGain: totalAccuracyGain / questionsRun,

    totalBaselineTokens,
    totalWithGraphTokens,
    tokensSaved,

    questionsRun,
    questionsWhereGraphHelped,
    questionsWhereGraphWasNeutral,
    questionsWhereGraphHurt,
  };
}
