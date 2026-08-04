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

/**
 * Standard error of the mean for a sample: sampleStdDev / sqrt(n). Returns 0
 * for fewer than 2 samples — there's no spread to measure from a single
 * point, and reporting `NaN` there would be worse than reporting "no
 * measured variance" as zero.
 */
function standardError(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) / Math.sqrt(n);
}

/**
 * Propagates independent per-question standard errors into the standard
 * error of their sum divided by a constant (the usual `Var(aX) = a^2 Var(X)`
 * and `Var(X+Y) = Var(X) + Var(Y)` rules for independent X, Y) — used to
 * carry `tokensPerCorrectAnswer`'s uncertainty from each question's own
 * `accuracyStdErr`, when present, rather than reporting a bare number with
 * no sense of how much run-to-run noise could explain a change in it.
 */
function propagatedRatioStdErr(tokens: number[], accuracyFractions: number[], accuracyStdErrs: number[]): number | undefined {
  if (accuracyStdErrs.every((e) => e === 0)) return undefined;
  const totalCorrect = accuracyFractions.reduce((a, b) => a + b, 0);
  if (totalCorrect === 0) return undefined;
  // d(tokensPerCorrectAnswer)/d(accuracy_i) = -tokens_i * totalTokens / totalCorrect^2,
  // approximated here holding other questions' accuracy fixed (independence assumption).
  const totalTokens = tokens.reduce((a, b) => a + b, 0);
  const variance = accuracyStdErrs.reduce((sum, stdErr, i) => {
    const partial = (tokens[i] * totalTokens) / totalCorrect ** 2;
    return sum + (partial * stdErr) ** 2;
  }, 0);
  return Math.sqrt(variance);
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

  // For tokensPerCorrectAnswer (spec 064) — scored against the WITH-GRAPH
  // condition, since that's the configuration nodum actually ships; the
  // baseline (no graph) run exists to measure improvement, not to be a
  // candidate "tokens per correct answer" figure in its own right.
  const withGraphTokensPerQuestion: number[] = [];
  const withGraphAccuracyFractions: number[] = [];
  const withGraphAccuracyStdErrs: number[] = [];

  for (const result of results) {
    totalTokenReduction += result.improvement.tokenReduction;
    totalInputTokenReduction += result.improvement.inputTokenReduction;
    totalOutputTokenReduction += result.improvement.outputTokenReduction;
    totalLatencyImprovement += result.improvement.latencyImprovement;
    totalAccuracyGain += result.improvement.accuracyGain;

    totalBaselineTokens += result.baseline.tokensUsed;
    totalWithGraphTokens += result.withGraph.tokensUsed;

    withGraphTokensPerQuestion.push(result.withGraph.tokensUsed);
    withGraphAccuracyFractions.push(result.withGraph.accuracy / 100);
    withGraphAccuracyStdErrs.push(result.withGraph.accuracyStdErr ?? 0);

    if (result.improvement.tokenReduction > 0.1) {
      questionsWhereGraphHelped++;
    } else if (result.improvement.tokenReduction > -0.1) {
      questionsWhereGraphWasNeutral++;
    } else {
      questionsWhereGraphHurt++;
    }
  }

  const tokensSaved = totalBaselineTokens - totalWithGraphTokens;

  const totalCorrectAnswerCredit = withGraphAccuracyFractions.reduce((a, b) => a + b, 0);
  const tokensPerCorrectAnswer =
    totalCorrectAnswerCredit === 0 ? Infinity : totalWithGraphTokens / totalCorrectAnswerCredit;
  const tokensPerCorrectAnswerStdErr = propagatedRatioStdErr(
    withGraphTokensPerQuestion,
    withGraphAccuracyFractions,
    withGraphAccuracyStdErrs,
  );

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

    tokensPerCorrectAnswer,
    ...(tokensPerCorrectAnswerStdErr !== undefined ? { tokensPerCorrectAnswerStdErr } : {}),
  };
}

/**
 * Mean and standard error of a set of per-run accuracy scores for one
 * question (spec 064) — a single sample can't distinguish "this release
 * changed accuracy" from ordinary run-to-run noise, so `harness.ts` scores
 * every retry's response instead of just the first and calls this to
 * collapse them into the `accuracy`/`accuracyStdErr` pair `QuestionResult`
 * expects.
 */
export function summarizeAccuracyRuns(accuracyScores: number[]): { mean: number; stdErr: number } {
  const mean = accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length;
  return { mean, stdErr: standardError(accuracyScores) };
}
