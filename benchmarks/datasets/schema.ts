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
    accuracy: number; // % of expected elements found
  };

  // Results WITH graph context
  withGraph: {
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    response: string;
    accuracy: number;
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
  };
}
