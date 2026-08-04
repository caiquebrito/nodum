<!-- nodum:start -->
## Knowledge Graph Context — Nodum

**Load this before each response.** Stack: **TypeScript · Node.js (ESM)** | Files: **54** | Functions: **491** | Last sync: **2026-06-01 20:33**

Analyze code with this project's structure in mind. Reference the knowledge graph when answering questions about code organization, dependencies, or implementation patterns.
<!-- nodum:end -->

## Working on this repo — durable rules

Everything below this line is never touched by `nodum sync` (it only rewrites the marker block
above), so it persists across sessions. Full detail lives in `CONTRIBUTING.md` and
`docs/development/ROADMAP.md` — this is the compressed version so it doesn't need re-deriving
every session.

### Spec-driven workflow

Every non-trivial change is a spec under `docs/development/`, moving through three folders in
order: **`refined/`** (fully designed, not yet started — write a whole planned arc here up front
so it survives a session boundary) → **`active/`** (branch created, PR open) → **`completed/`**
(merged, `## Status: done`, rewritten to describe what was actually built). `NNN` is the next
unused number across all three folders. Branch `feature/NNN-kebab-slug` from `develop`, PR title
`<Type>: <imperative sentence> (spec NNN)`, PR into `develop` (never `main` directly).

**Merge policy: merge each spec's PR as soon as `build-and-test` CI is green — don't wait for
manual approval (the repo requires 0 approvals; a green check is the actual gate per
`CONTRIBUTING.md`).** One spec, one branch, one PR, one merge, then move to the next spec. Use
`gh pr merge <n> --merge --delete-branch` after confirming `gh pr checks <n>` is green.

### Measuring whether a change actually helped

Don't guess — three real, already-built ways to check, cheapest first:

1. **Retrieval quality, no LLM, free, seconds:** `npx tsx benchmarks/retrieval/retrieval-eval.ts`
   (add `--embeddings` to also score the hybrid keyword+semantic ranker). Reports Recall@k,
   Precision@k, MRR, nDCG against `benchmarks/retrieval/golden-set.json`. This is the harness to
   run before/after any change to `packages/mcp/src/smart-context.ts`, `semantic-search.ts`, or
   `embeddings.ts` — record the before/after numbers in the spec's Success Metrics section.
   `benchmarks/retrieval/retrieval-eval.test.ts` gates a regression floor on every PR.
2. **Real session telemetry:** `nodum metrics [projectPath]` reads
   `~/.nodum/<project>/logs/metrics.jsonl` and reports per-tool call counts, latency percentiles,
   cache-hit rate, and truncation rate from actual usage.
3. **End-to-end LLM-facing, costs real API budget, nightly-only:** `benchmarks/harness.ts` (via
   `cd benchmarks && npm run run:sample`, needs `ANTHROPIC_API_KEY`) computes
   `tokensPerCorrectAnswer` — the project's north-star metric — and stores it per-release under
   `benchmarks/baselines/<version>.json` so each run diffs against the prior release. Don't run
   this speculatively; it's gated to `.github/workflows/benchmark-accuracy.yml`'s nightly/manual
   schedule for a reason (real spend).

**Rule:** a change to ranking/retrieval logic doesn't ship without a before/after from #1 in its
spec. A change to token cost/rendering doesn't ship without a real timing or token-count
before/after.

### Current plan

The active multi-spec plan (accuracy, token efficiency, measurement, IDE reach) lives fully
written under `docs/development/refined/066-*` through `074-*`, sequenced in
`docs/development/ROADMAP.md`. Specs 063-065 (the measurement floor this plan's later specs
depend on) are done, in `docs/development/completed/`.