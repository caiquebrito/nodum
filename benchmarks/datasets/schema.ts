export type QuestionCategory = 'function' | 'dependency' | 'architecture' | 'refactor' | 'bug-find';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Language = 'typescript' | 'python' | 'kotlin' | 'mixed';

export interface BenchmarkQuestion {
  id: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  language: Language;

  // The actual question asked to Claude
  question: string;

  // Expected answer elements (for accuracy scoring)
  expectedElements: {
    functions?: string[];
    files?: string[];
    classes?: string[];
    conceptsMentioned?: string[];
  };

  // Context for why this question matters
  context: string;
}

export interface QuestionResult {
  question: BenchmarkQuestion;

  // Results WITHOUT graph context
  baseline: {
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    response: string;
    accuracy: number; // mean % of expected elements found, across N repeated runs
    // Standard error of `accuracy` across the repeated runs (spec 064) —
    // undefined for a caller that only ever scored a single run. A single
    // sample can't distinguish "this release changed accuracy" from normal
    // run-to-run noise; this is what makes that distinction checkable.
    accuracyStdErr?: number;
  };

  // Results WITH graph context
  withGraph: {
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    response: string;
    accuracy: number;
    accuracyStdErr?: number;
  };

  // Calculated improvements
  improvement: {
    tokenReduction: number; // % reduction
    inputTokenReduction: number;
    outputTokenReduction: number;
    latencyImprovement: number; // % improvement
    accuracyGain: number; // percentage points
  };
}

export interface BenchmarkSummary {
  projectName: string;
  projectPath: string;
  projectStats: {
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
    edges: number;
  };
  timestamp: string;
  // The nodum release this run measured — from root package.json, since the
  // lockstep lockfile group means all four published packages share it.
  // Used to key the stored baseline file (spec 064) so a release-over-
  // release delta can be reported instead of an absolute number with no
  // reference point.
  nodumVersion?: string;

  results: QuestionResult[];

  // Aggregated statistics
  aggregate: {
    avgTokenReduction: number;
    avgInputTokenReduction: number;
    avgOutputTokenReduction: number;
    avgLatencyImprovement: number;
    avgAccuracyGain: number;

    totalBaselineTokens: number;
    totalWithGraphTokens: number;
    tokensSaved: number;

    questionsRun: number;
    questionsWhereGraphHelped: number;
    questionsWhereGraphWasNeutral: number;
    questionsWhereGraphHurt: number;

    // The declared north-star metric (see docs/development/ROADMAP.md's
    // Success metrics section, spec 064): total tokens spent with graph
    // context divided by total "correct answer" credit earned, where credit
    // is `accuracy / 100` per question (a 100%-accurate answer counts as one
    // full correct answer; a 50%-accurate one counts as half). Lower is
    // better — fewer tokens per unit of correct answer. `Infinity` if no
    // question earned any accuracy credit at all (avoids a divide-by-zero
    // reading as 0, which would look like a perfect score).
    tokensPerCorrectAnswer: number;
    // Standard error of `tokensPerCorrectAnswer` across questions, when the
    // underlying per-question accuracy scores carry their own run-to-run
    // variance (i.e. `accuracyStdErr` was populated) — undefined otherwise.
    tokensPerCorrectAnswerStdErr?: number;
  };
}

/** One release's stored aggregate, as written to benchmarks/baselines/<version>.json. */
export interface StoredBaseline {
  nodumVersion: string;
  timestamp: string;
  projectName: string;
  aggregate: BenchmarkSummary['aggregate'];
}
