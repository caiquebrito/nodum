import { resolve, basename, dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { syncProject } from '@caiquebrito/nodum-core';
import { ClaudeAPI } from './claude-api.js';
import { scoreAccuracy, aggregateResults, summarizeAccuracyRuns } from './metrics.js';
import { generateHTMLReport } from './report-generator.js';
import { baselineFromSummary, writeBaseline, loadPreviousBaseline, diffAgainstBaseline } from './baseline-store.js';
import type {
  BenchmarkQuestion,
  QuestionResult,
  BenchmarkSummary,
} from './datasets/schema.js';

const NODUM_DATA_DIR = `${process.env.HOME}/.nodum-benchmark`;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function readNodumVersion(): Promise<string> {
  try {
    const raw = await readFile(join(__dirname, '..', 'package.json'), 'utf-8');
    return JSON.parse(raw).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function loadQuestions(): Promise<BenchmarkQuestion[]> {
  try {
    const data = await readFile(
      new URL('./datasets/mvp-questions.json', import.meta.url),
      'utf-8',
    );
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading questions:', err);
    return [];
  }
}

async function runBenchmark(projectPath: string): Promise<void> {
  const absolutePath = resolve(projectPath);
  const projectName = basename(absolutePath);

  console.log(`\n🎯 Nodum Benchmark Suite`);
  console.log(`Project: ${projectName}`);
  console.log(`Path: ${absolutePath}\n`);

  try {
    // 1. Sync the project
    console.log('📊 Scanning project with nodum...');
    const graph = await syncProject(absolutePath, NODUM_DATA_DIR);
    console.log(`✅ Scanned: ${graph.stats.files} files, ${graph.stats.functions} functions\n`);

    // 2. Load benchmark questions
    console.log('📋 Loading benchmark questions...');
    const questions = await loadQuestions();
    if (questions.length === 0) {
      console.error('❌ No questions found. Create datasets/mvp-questions.json first.');
      return;
    }
    console.log(`✅ Loaded ${questions.length} questions\n`);

    // 3. Initialize Claude API
    const claude = new ClaudeAPI();

    // 4. Run benchmark for each question
    console.log(`🔄 Running benchmark on ${questions.length} questions...`);
    console.log('This may take a few minutes.\n');

    const results: QuestionResult[] = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`[${i + 1}/${questions.length}] ${question.id}: ${question.question.substring(0, 60)}...`);

      // Without graph context
      console.log('  → Testing WITHOUT graph...');
      const withoutContext = await claude.callWithRetries(
        'You are a code analysis expert. Answer the user\'s question about the provided code.',
        question.question,
        2,
      );

      // With graph context - inject the SUMMARY.md from nodum
      console.log('  → Testing WITH graph...');
      let graphContext = '';
      try {
        const summaryPath = `${NODUM_DATA_DIR}/${projectName}/memory/SUMMARY.md`;
        graphContext = await readFile(summaryPath, 'utf-8');
      } catch {
        console.warn('  ⚠️  Could not load project summary');
      }

      const withGraphPrompt = `You are a code analysis expert analyzing a project.

Here is the project structure and context:
${graphContext}

Now answer this question about the code:
${question.question}`;

      const withGraphResult = await claude.callWithRetries(
        'You are a code analysis expert. Use the provided project context to answer accurately.',
        withGraphPrompt,
        2,
      );

      // Calculate accuracy — scored against every retried response, not
      // just the first, so `accuracyStdErr` reflects real run-to-run
      // variance instead of always reading as zero (spec 064: a single
      // sample can't tell "this release changed accuracy" apart from
      // ordinary noise).
      const baselineAccuracyRuns = withoutContext.allResponses.map((r) =>
        scoreAccuracy(r, question.expectedElements),
      );
      const withGraphAccuracyRuns = withGraphResult.allResponses.map((r) =>
        scoreAccuracy(r, question.expectedElements),
      );
      const { mean: baselineAccuracy, stdErr: baselineAccuracyStdErr } =
        summarizeAccuracyRuns(baselineAccuracyRuns);
      const { mean: withGraphAccuracy, stdErr: withGraphAccuracyStdErr } =
        summarizeAccuracyRuns(withGraphAccuracyRuns);

      // Calculate improvements
      const tokenReduction =
        ((withoutContext.metrics.totalTokens - withGraphResult.metrics.totalTokens) /
          withoutContext.metrics.totalTokens) *
        100;
      const latencyImprovement =
        ((withoutContext.metrics.latencyMs - withGraphResult.metrics.latencyMs) /
          withoutContext.metrics.latencyMs) *
        100;
      const inputTokenReduction =
        ((withoutContext.metrics.inputTokens - withGraphResult.metrics.inputTokens) /
          withoutContext.metrics.inputTokens) *
        100;
      const outputTokenReduction =
        ((withoutContext.metrics.outputTokens - withGraphResult.metrics.outputTokens) /
          withoutContext.metrics.outputTokens) *
        100;

      const result: QuestionResult = {
        question,
        baseline: {
          tokensUsed: withoutContext.metrics.totalTokens,
          inputTokens: withoutContext.metrics.inputTokens,
          outputTokens: withoutContext.metrics.outputTokens,
          latencyMs: withoutContext.metrics.latencyMs,
          response: withoutContext.response,
          accuracy: baselineAccuracy,
          accuracyStdErr: baselineAccuracyStdErr,
        },
        withGraph: {
          tokensUsed: withGraphResult.metrics.totalTokens,
          inputTokens: withGraphResult.metrics.inputTokens,
          outputTokens: withGraphResult.metrics.outputTokens,
          latencyMs: withGraphResult.metrics.latencyMs,
          response: withGraphResult.response,
          accuracy: withGraphAccuracy,
          accuracyStdErr: withGraphAccuracyStdErr,
        },
        improvement: {
          tokenReduction,
          inputTokenReduction,
          outputTokenReduction,
          latencyImprovement,
          accuracyGain: withGraphAccuracy - baselineAccuracy,
        },
      };

      results.push(result);

      // Print summary for this question
      console.log(
        `  ✅ Tokens: ${result.improvement.tokenReduction > 0 ? '↓' : '↑'} ${Math.abs(result.improvement.tokenReduction).toFixed(1)}% | Accuracy: ${withGraphAccuracy > baselineAccuracy ? '↑' : '↓'} ${Math.abs(result.improvement.accuracyGain).toFixed(1)}%\n`,
      );
    }

    // 5. Aggregate and generate report
    console.log(`\n📊 Generating benchmark report...`);
    const aggregate = aggregateResults(results);
    const nodumVersion = await readNodumVersion();

    const summary: BenchmarkSummary = {
      projectName,
      projectPath: absolutePath,
      projectStats: graph.stats,
      timestamp: new Date().toISOString(),
      nodumVersion,
      results,
      aggregate,
    };

    // Store this run's aggregate under its release version and diff it
    // against the immediately-preceding release's stored baseline, if one
    // exists (spec 064) — the north-star metric only means something release
    // over release, not as a single absolute number.
    const previousBaseline = await loadPreviousBaseline(nodumVersion);
    const delta = previousBaseline ? diffAgainstBaseline(summary, previousBaseline) : null;
    await writeBaseline(baselineFromSummary(summary, nodumVersion));

    const reportPath = `./benchmark-report-${projectName}-${Date.now()}.html`;
    await generateHTMLReport(summary, reportPath, delta);

    // 6. Print final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('BENCHMARK COMPLETE');
    console.log(`${'='.repeat(60)}`);
    console.log(`\n📈 Results Summary:`);
    console.log(`  Token Reduction: ${aggregate.avgTokenReduction.toFixed(2)}%`);
    console.log(`  Speed Improvement: ${aggregate.avgLatencyImprovement.toFixed(2)}%`);
    console.log(`  Accuracy Gain: ${aggregate.avgAccuracyGain.toFixed(2)}%`);
    console.log(`  Tokens Saved: ${aggregate.tokensSaved.toLocaleString()}`);
    console.log(`\n🎯 Tokens per correct answer: ${
      Number.isFinite(aggregate.tokensPerCorrectAnswer) ? aggregate.tokensPerCorrectAnswer.toFixed(1) : '∞ (no accuracy credit earned)'
    }${aggregate.tokensPerCorrectAnswerStdErr !== undefined ? ` (± ${aggregate.tokensPerCorrectAnswerStdErr.toFixed(1)})` : ''}`);
    if (delta) {
      console.log(
        `   vs. v${delta.previousVersion}: ${delta.tokensPerCorrectAnswerDelta <= 0 ? '↓' : '↑'} ${Math.abs(delta.tokensPerCorrectAnswerPercentChange).toFixed(1)}%`,
      );
    } else {
      console.log(`   (no prior baseline to compare against — this run establishes v${nodumVersion}'s)`);
    }
    console.log(`\n📊 Graph Effectiveness:`);
    console.log(`  Helped: ${aggregate.questionsWhereGraphHelped}/${aggregate.questionsRun}`);
    console.log(`  Neutral: ${aggregate.questionsWhereGraphWasNeutral}/${aggregate.questionsRun}`);
    console.log(`  Hurt: ${aggregate.questionsWhereGraphHurt}/${aggregate.questionsRun}`);
    console.log(`\n📄 Full report: ${reportPath}\n`);
  } catch (error) {
    console.error('❌ Benchmark error:', error);
    process.exit(1);
  }
}

// Main
const projectPath = process.argv[2] || './benchmarks/projects/sample-next-app';
runBenchmark(projectPath).catch(console.error);
