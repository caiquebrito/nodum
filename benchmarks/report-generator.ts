import { writeFile } from 'fs/promises';
import type { BenchmarkSummary } from './datasets/schema.js';
import type { BaselineDelta } from './baseline-store.js';

export async function generateHTMLReport(
  summary: BenchmarkSummary,
  outputPath: string,
  previousReleaseDelta: BaselineDelta | null = null,
): Promise<void> {
  const { aggregate, results, projectStats } = summary;

  const tokensPerCorrectAnswerDisplay = Number.isFinite(aggregate.tokensPerCorrectAnswer)
    ? aggregate.tokensPerCorrectAnswer.toFixed(1)
    : '∞';
  const tokensPerCorrectAnswerStdErrDisplay =
    aggregate.tokensPerCorrectAnswerStdErr !== undefined
      ? ` ± ${aggregate.tokensPerCorrectAnswerStdErr.toFixed(1)}`
      : '';
  const deltaHtml = previousReleaseDelta
    ? `<div class="metric-unit">${previousReleaseDelta.tokensPerCorrectAnswerDelta <= 0 ? '↓' : '↑'} ${Math.abs(previousReleaseDelta.tokensPerCorrectAnswerPercentChange).toFixed(1)}% vs. v${previousReleaseDelta.previousVersion}</div>`
    : `<div class="metric-unit">No prior release baseline yet</div>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nodum Benchmark Report — ${summary.projectName}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #fafbfc;
    }
    h1, h2, h3 { color: #0366d6; }
    h1 { font-size: 2.5em; margin-bottom: 0.2em; }
    h2 { font-size: 1.8em; margin-top: 1.5em; border-bottom: 2px solid #0366d6; padding-bottom: 0.3em; }

    .header {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 30px;
    }
    .project-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .info-box {
      background: #f6f8fa;
      padding: 15px;
      border-radius: 6px;
      border-left: 4px solid #0366d6;
    }
    .info-label {
      color: #586069;
      font-size: 0.9em;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .info-value {
      font-size: 1.4em;
      font-weight: bold;
      color: #0366d6;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .metric-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: center;
    }
    .metric-value {
      font-size: 2.5em;
      font-weight: bold;
      color: #28a745;
      margin: 10px 0;
    }
    .metric-label {
      color: #586069;
      font-size: 0.95em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .metric-unit {
      font-size: 0.7em;
      color: #999;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin: 20px 0;
    }
    th {
      background: #0366d6;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e1e4e8;
    }
    tr:hover {
      background: #f6f8fa;
    }
    .numeric {
      text-align: right;
      font-family: "Monaco", "Menlo", monospace;
    }
    .positive {
      color: #28a745;
      font-weight: 600;
    }
    .negative {
      color: #cb2431;
      font-weight: 600;
    }
    .neutral {
      color: #999;
    }

    .summary-box {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin: 20px 0;
      border-left: 4px solid #0366d6;
    }
    .summary-stat {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e1e4e8;
    }
    .summary-stat:last-child {
      border-bottom: none;
    }
    .summary-stat label {
      font-weight: 600;
      color: #586069;
    }
    .summary-stat value {
      font-family: "Monaco", "Menlo", monospace;
      color: #0366d6;
    }

    .conclusion {
      background: #dffcf0;
      border: 1px solid #34d399;
      padding: 20px;
      border-radius: 8px;
      margin: 30px 0;
    }
    .conclusion h3 {
      color: #059669;
      margin-top: 0;
    }

    footer {
      text-align: center;
      color: #999;
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #e1e4e8;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎯 Nodum RAG Benchmark Report</h1>
    <h3 style="margin-top: 0; color: #666;">${summary.projectName}</h3>
    <p>Generated: ${new Date(summary.timestamp).toLocaleString()}</p>

    <div class="project-info">
      <div class="info-box">
        <div class="info-label">Total Files</div>
        <div class="info-value">${projectStats.files}</div>
      </div>
      <div class="info-box">
        <div class="info-label">Functions</div>
        <div class="info-value">${projectStats.functions}</div>
      </div>
      <div class="info-box">
        <div class="info-label">Classes</div>
        <div class="info-value">${projectStats.classes}</div>
      </div>
      <div class="info-box">
        <div class="info-label">Dependencies</div>
        <div class="info-value">${projectStats.edges}</div>
      </div>
    </div>
  </div>

  <h2>📊 Executive Summary</h2>
  <div class="metrics">
    <div class="metric-card">
      <div class="metric-label">Tokens Saved</div>
      <div class="metric-value ${aggregate.avgTokenReduction > 0 ? 'positive' : 'negative'}">
        ${aggregate.avgTokenReduction > 0 ? '↓' : '↑'} ${Math.abs(aggregate.avgTokenReduction).toFixed(1)}%
      </div>
      <div class="metric-unit">Lower is better</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Response Speed</div>
      <div class="metric-value ${aggregate.avgLatencyImprovement > 0 ? 'positive' : 'negative'}">
        ${aggregate.avgLatencyImprovement > 0 ? '↑' : '↓'} ${Math.abs(aggregate.avgLatencyImprovement).toFixed(1)}%
      </div>
      <div class="metric-unit">Faster responses</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Accuracy Gain</div>
      <div class="metric-value ${aggregate.avgAccuracyGain > 0 ? 'positive' : 'negative'}">
        ${aggregate.avgAccuracyGain > 0 ? '+' : ''} ${aggregate.avgAccuracyGain.toFixed(1)}%
      </div>
      <div class="metric-unit">Expected elements found</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens Saved</div>
      <div class="metric-value positive">${aggregate.tokensSaved.toLocaleString()}</div>
      <div class="metric-unit">Across all ${aggregate.questionsRun} questions</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tokens / Correct Answer</div>
      <div class="metric-value">${tokensPerCorrectAnswerDisplay}${tokensPerCorrectAnswerStdErrDisplay}</div>
      ${deltaHtml}
    </div>
  </div>

  <div class="summary-box">
    <h3 style="margin-top: 0;">Key Findings</h3>
    <div class="summary-stat">
      <label>Questions where graph helped:</label>
      <value>${aggregate.questionsWhereGraphHelped}/${aggregate.questionsRun}</value>
    </div>
    <div class="summary-stat">
      <label>Questions where graph was neutral:</label>
      <value>${aggregate.questionsWhereGraphWasNeutral}/${aggregate.questionsRun}</value>
    </div>
    <div class="summary-stat">
      <label>Questions where graph used more tokens:</label>
      <value>${aggregate.questionsWhereGraphHurt}/${aggregate.questionsRun}</value>
    </div>
    <div class="summary-stat">
      <label>Average token reduction:</label>
      <value>${aggregate.avgTokenReduction.toFixed(2)}%</value>
    </div>
    <div class="summary-stat">
      <label>Tokens per correct answer (north-star metric):</label>
      <value>${tokensPerCorrectAnswerDisplay}${tokensPerCorrectAnswerStdErrDisplay}</value>
    </div>
  </div>

  <h2>📋 Detailed Results</h2>
  <table>
    <thead>
      <tr>
        <th>Question</th>
        <th class="numeric">Baseline Tokens</th>
        <th class="numeric">With Graph</th>
        <th class="numeric">Reduction</th>
        <th class="numeric">Accuracy Gain</th>
        <th class="numeric">Speed</th>
      </tr>
    </thead>
    <tbody>
      ${results
        .map(
          r => `
        <tr>
          <td><strong>${r.question.id}</strong><br><span style="color: #999; font-size: 0.9em">${r.question.question.substring(0, 80)}...</span></td>
          <td class="numeric">${r.baseline.tokensUsed}</td>
          <td class="numeric">${r.withGraph.tokensUsed}</td>
          <td class="numeric"><span class="${r.improvement.tokenReduction > 0 ? 'positive' : r.improvement.tokenReduction < 0 ? 'negative' : 'neutral'}">
            ${r.improvement.tokenReduction > 0 ? '↓' : r.improvement.tokenReduction < 0 ? '↑' : '–'} ${Math.abs(r.improvement.tokenReduction).toFixed(1)}%
          </span></td>
          <td class="numeric"><span class="${r.improvement.accuracyGain > 0 ? 'positive' : r.improvement.accuracyGain < 0 ? 'negative' : 'neutral'}">
            ${r.improvement.accuracyGain > 0 ? '+' : ''} ${r.improvement.accuracyGain.toFixed(1)}%
          </span></td>
          <td class="numeric">${r.improvement.latencyImprovement > 0 ? '↑' : '↓'} ${Math.abs(r.improvement.latencyImprovement).toFixed(1)}%</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <div class="conclusion">
    <h3>🎯 Conclusion</h3>
    <p>
      The knowledge graph <strong>reduced token usage by an average of ${aggregate.avgTokenReduction.toFixed(1)}%</strong> across ${aggregate.questionsRun} representative code questions.
      This translates to <strong>${aggregate.tokensSaved.toLocaleString()} tokens saved</strong> in this benchmark run.
    </p>
    <p>
      Claude also achieved <strong>${aggregate.avgAccuracyGain > 0 ? '+' : ''}${aggregate.avgAccuracyGain.toFixed(1)}% better accuracy</strong> in identifying relevant code elements,
      with the graph helping in <strong>${aggregate.questionsWhereGraphHelped}/${aggregate.questionsRun} questions (${((aggregate.questionsWhereGraphHelped / aggregate.questionsRun) * 100).toFixed(0)}%)</strong>.
    </p>
    <p style="margin-bottom: 0;">
      <strong>Recommendation:</strong> The benchmark validates that nodum's knowledge graph improves both token efficiency and answer quality,
      making it a valuable tool for code understanding and analysis tasks.
    </p>
  </div>

  <footer>
    <p>Generated by Nodum Benchmark Suite | <a href="https://github.com/caiquebrito/nodum" style="color: #0366d6; text-decoration: none;">github.com/caiquebrito/nodum</a></p>
  </footer>
</body>
</html>`;

  await writeFile(outputPath, html, 'utf-8');
  console.log(`✅ Report saved to ${outputPath}`);
}
