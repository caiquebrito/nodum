# Nodum Benchmark Suite

Benchmark harness to measure the effectiveness of nodum's knowledge graph on Claude's code
understanding: token efficiency, accuracy, and latency, with vs. without graph context.

## What It Measures

- **Token Efficiency**: How many tokens does Claude use WITH vs WITHOUT the graph?
- **Accuracy**: Does Claude identify the correct code elements better with context?
- **Latency**: Speed improvements from having the graph context

## Where the Real Numbers Live

This benchmark suite's own historical output (`v2-demo:sample`, `run:sample`) used to be quoted
here as fixed percentages (e.g. "89% fewer tokens", "90% savings"). As the root
[README.md](../README.md#token-efficiency) explains, those were the v2.0.0 design's *initial
targets*, not numbers with confidence intervals behind them — v2.2.0's truth-and-measurement
batch (specs `021`–`029`) replaced that framing with **real, per-response measurement**:

- Every `search_graph` MCP call reports its own measured token savings against a full-graph-dump
  baseline, computed via a real tokenizer — not a hardcoded percentage.
- Every MCP tool call is logged to `~/.nodum/<project>/logs/metrics.jsonl` (timestamp, tool,
  duration, approximate tokens, success), so real-session efficiency is inspectable directly.

Run this harness against your own project (see Quick Start below) to get numbers for *your*
codebase rather than trusting a number measured on someone else's sample app.

## MVP Scope

- **15 curated questions**: 5 TypeScript, 5 Python, 5 Mixed/cross-language
- **1 sample project**: Realistic Next.js app for testing
- **Est. runtime**: 10-15 minutes (or ~2 minutes with demo mode)
- **Est. cost**: a few dollars in API calls (or $0 with demo mode)

## Quick Start

### Option 1: Fast Demo (No API Key Needed)

```bash
cd benchmarks
npm install

# See context-size efficiency on the sample project (instant)
npm run v2-demo:sample

# Or on your own project
npm run v2-demo -- /path/to/your/project
```

Output shows context size comparison and token savings without any API calls.

### Option 2: Full Benchmark (Requires ANTHROPIC_API_KEY)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

# Run against the sample project
npm run run:sample

# Or against your own project
npm run run -- /path/to/your/project
```

Generates a detailed HTML report with token counts, latency, and accuracy metrics.

## What Happens (Full Benchmark)

1. **Scans your project** with nodum → generates a knowledge graph with clusters.
2. **Asks 15 questions** to Claude in two scenarios: WITHOUT the knowledge graph context, and WITH
   it (smart context — keyword + semantic scoring, clustering; see
   [`docs/architecture/SMART-CONTEXT.md`](../docs/architecture/SMART-CONTEXT.md)).
3. **Measures for each question**: token count (input + output), response latency, and accuracy
   (percentage of expected code elements found).
4. **Generates an HTML report** with the real, measured numbers for that run.

## Sample Project

Located in `projects/sample-next-app/`: a realistic Next.js TypeScript application (auth system,
API routes, data models) used as a small, reproducible fixture.

## Files

- `v2-demo.ts` — fast demo showing context efficiency (no API calls needed)
- `v2-comparison.ts` — detailed comparison across nodum's context strategies (requires API key)
- `harness.ts` — full benchmark runner with HTML reports
- `claude-api.ts` — wrapper around the Anthropic SDK with token counting
- `metrics.ts` — accuracy scoring and result aggregation
- `report-generator.ts` — HTML report generation
- `datasets/mvp-questions.json` — the 15 MVP benchmark questions
- `datasets/schema.ts` — TypeScript interfaces

`benchmarks/` is a workspace in the root `package.json` and runs in CI via
`.github/workflows/benchmark-accuracy.yml` (spec 028) — it's part of the release gate, not a
standalone demo.

## Requirements

### For v2-demo (No API Key)
- Node 18+
- `npm install` in the `benchmarks/` directory
- Cost: free, no API calls

### For Full Benchmark
- Node 18+
- `ANTHROPIC_API_KEY` environment variable set
- A small API budget (depends on project size and question count)
- Model: `claude-opus-5` by default (`claude-api.ts`'s `DEFAULT_MODEL`), overridable via
  `NODUM_BENCHMARK_MODEL`

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

`expectedElements` are used to score accuracy by checking whether Claude's answer mentions them.

## Interpreting the Report

The HTML report shows:

1. **Executive Summary** — overall improvements (tokens saved, speed, accuracy) for this run
2. **Key Findings** — how many questions the graph helped with
3. **Question-by-Question Breakdown** — individual results for each question
4. **Conclusion** — summary of graph-context effectiveness for this project

Treat these numbers as specific to the project you ran the benchmark against — they're real
measurements, not a claim that generalizes to every codebase.
