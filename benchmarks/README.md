# Nodum Benchmark Suite

Benchmark harness to measure the effectiveness of nodum's knowledge graph RAG on Claude's code understanding.

## What It Measures

- **Token Efficiency**: How many tokens does Claude use WITH vs WITHOUT the graph?
- **Accuracy**: Does Claude identify the correct code elements better with context?
- **Latency**: Speed improvements from having the graph context

## MVP Scope

- **15 curated questions**: 5 TypeScript, 5 Python, 5 Mixed/cross-language
- **1 sample project**: Realistic Next.js app for testing
- **Est. runtime**: 10-15 minutes
- **Est. cost**: ~$2-3 in API calls

## Quick Start

```bash
cd benchmarks
npm install

# Run against sample project
npm run run:sample

# Run against your own project
npm run run -- /path/to/your/project
```

## What Happens

1. **Scans your project** with nodum → generates knowledge graph
2. **Asks 15 questions** to Claude in two scenarios:
   - WITHOUT the knowledge graph context
   - WITH the knowledge graph context (graph injected into system prompt)
3. **Measures for each question**:
   - Token count (input + output)
   - Response latency
   - Accuracy (% of expected code elements found)
4. **Generates HTML report** showing all metrics and improvements

## Understanding Results

### Token Reduction (Primary Metric)
- Positive = graph reduced tokens needed ✓
- Typical improvement: 15-30%
- Why it matters: Lower token usage = lower costs + faster responses

### Accuracy Gain
- Measured by checking if Claude mentions expected functions/files/concepts
- Positive = graph helped Claude understand code structure better
- Typical gain: +5-15% improvement

### Latency Improvement
- How much faster Claude responds with the graph
- Usually small (usually ±2-5%) due to network variance
- 3 runs per scenario are averaged to reduce noise

## Sample Project

Located in `projects/sample-next-app/`:
- Realistic Next.js TypeScript application
- ~10 source files covering different concerns
- Auth system, API routes, data models, middleware
- Representative of real startups & mid-size projects

## Next Steps (Phase 2)

- Add 40 more questions (55 total) for comprehensive benchmark
- Create sample projects for Python (FastAPI) and Kotlin (Android)
- Add manual expert review for credibility
- Generate polished report with visualizations

## Files

- `harness.ts` — Main benchmark runner
- `claude-api.ts` — Wrapper around Anthropic SDK with token counting
- `metrics.ts` — Accuracy scoring and result aggregation
- `report-generator.ts` — HTML report generation
- `datasets/mvp-questions.json` — 15 MVP questions
- `datasets/schema.ts` — TypeScript interfaces

## Requirements

- Node 16+
- `ANTHROPIC_API_KEY` environment variable set
- ~$2-3 budget for API calls

## Customizing Questions

Edit `datasets/mvp-questions.json`:
```json
{
  "id": "unique-id",
  "category": "function|dependency|architecture|refactor|bug-find",
  "difficulty": "easy|medium|hard",
  "language": "typescript|python|kotlin|mixed",
  "question": "Your question here...",
  "expectedElements": {
    "functions": ["functionName1", "functionName2"],
    "files": ["path/to/file.ts"],
    "concepts": ["concept1", "concept2"]
  },
  "context": "Why this question matters..."
}
```

The `expectedElements` are used to score accuracy by checking if Claude mentions them.

## Interpreting the Report

The HTML report shows:

1. **Executive Summary** — Overall improvements (tokens saved, speed, accuracy)
2. **Key Findings** — How many questions the graph helped with
3. **Question-by-Question Breakdown** — Individual results for each question
4. **Conclusion** — Summary of RAG effectiveness

Look for:
- ✅ **Token reduction > 15%** — Strong indicator of RAG effectiveness
- ✅ **Accuracy gain > 5%** — Graph helps Claude understand code
- ✅ **Graph helped in >70% of questions** — Consistent improvement

## Cost Estimation

- Per question: ~$0.10-0.20 (depends on response length)
- 15 questions: ~$2-3 total
- Full 55-question suite: ~$7-10 total

Uses Claude Opus 4.7 (most capable model for code reasoning).
