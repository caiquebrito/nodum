import type { BenchmarkQuestion, BenchmarkSummary, QuestionResult } from './datasets/schema.js';

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
  return (found / total) * 100;
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
