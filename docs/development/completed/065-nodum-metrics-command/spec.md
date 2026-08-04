# 065 — `nodum metrics`: make telemetry readable

## Status: done

Implemented and tested (5 new `packages/mcp/src/index.test.ts` tests, 17 new
`packages/cli/src/commands/metrics.test.ts` tests; full workspace suite — 602 core, 119 cli,
15 server, 96 mcp, green via `npm test --workspaces`; benchmarks unaffected). Real check: ran
the built CLI binary against a hand-written `metrics.jsonl` fixture in `/tmp` (both formatted and
`--json` output) — see "Real end-to-end verification."

## Goal

Give `~/.nodum/<project>/logs/metrics.jsonl` — written by every MCP tool call since spec 025,
read by nothing — a way to actually be read.

## Why now

The metrics log has been write-only since spec 025. There's no `nodum metrics` command, no
aggregation, no trend line — just an append-only file accumulating on disk. Specs 066-068 (next
in this arc) are about to change ranking behavior in `packages/mcp`; being able to see real
session-level cache-hit rate and truncation rate before/after those changes, without spending
API budget, is exactly the kind of signal this closes the gap on. It also finishes the loop specs
063/064 started: those two make retrieval quality and the LLM-facing north-star metric
measurable in a benchmark harness; this one makes what real usage actually looked like visible
too.

## Scope

- **`packages/core/src/memory/metrics-log.ts`**: `ToolCallMetric` gains five new optional fields
  — `query`, `resultNodeCount`, `cacheHit`, `budgetApplied`, `truncated`. All additive and
  optional, so a JSONL line written by an older nodum version (with none of these fields) still
  parses as a valid `ToolCallMetric` — `nodum metrics` has to tolerate that, not assume every
  line has every field, and it does (see `summarizeMetrics`'s per-field "eligible calls" handling
  below).
- **`packages/mcp/src/index.ts`**'s `withMetrics` wrapper now populates those fields:
  - `query`/`budgetApplied` straight from the tool's own arguments (`args.query`,
    `typeof args.token_budget === "number"`).
  - `cacheHit`, `truncated`, `resultNodeCount` are derived by matching against the exact phrases
    `buildSmartContext` (`packages/mcp/src/smart-context.ts`) already appends to its own
    formatted response text (`"served from cache"`, `"truncated to fit token budget"`,
    `"Context includes: N relevant nodes"`) — a text-scrape, not a new structured return value
    threaded through every handler. Deliberate tradeoff: avoids touching `handlers.ts`'s dozen
    call sites just to log three fields; if `smart-context.ts`'s wording ever changes, these three
    fields silently stop populating rather than breaking anything — same best-effort posture
    `appendMetricsLog` itself already has.
- **`packages/cli/src/commands/metrics.ts`** (new) — `metricsCommand(projectPath, nodumDataDir,
  options)`, following the exact convention every other project-scoped command uses
  (`architecture.ts`, `dead-code.ts`, ...): resolves the project name from the path's basename,
  reads `<nodumDataDir>/<projectName>/logs/metrics.jsonl`. Exports:
  - `parseMetricsJsonl(raw)` — lenient line-by-line JSON parse; skips blank and malformed lines
    instead of failing the whole command on one torn write.
  - `summarizeMetrics(metrics)` — groups by tool, sorted by call count descending; per tool:
    call count, success rate, p50/p95 duration, mean `approxTokens` (only over calls that
    recorded one), cache-hit rate and truncation rate (each only over calls that reported that
    field **at all** — a tool with no cache/budget concept doesn't drag the rate toward 0 just by
    existing).
  - `metricsCommand` — formatted console output by default, `--json` for machine-readable output
    (same flag convention as `diffCommand`/`architectureCommand`). A missing log file (`ENOENT`)
    raises a clear, actionable message rather than a raw stack trace; any other read error is
    re-thrown unchanged.
- **`packages/cli/src/bin/nodum.ts`**: registers `nodum metrics [projectPath] [--json]`, same
  lazy `await import(...)` pattern as every other subcommand.
- **`README.md`**: adds `nodum metrics` to the CLI command reference.

## Out of scope

- **A dashboard or HTML report** — this is a CLI summary, matching the rest of `nodum`'s
  analysis commands (`cycles`, `dead-code`, `complexity`, ...), none of which have a dashboard
  either. `--json` covers anyone who wants to pipe this into something else.
- **Per-query-shape breakdowns** using the new `query` field (e.g. "which queries cache-hit most
  often") — the field is captured now so that's possible later, but this spec's job is making the
  log readable at all, not building every report it could support.
- **Threading structured cache/truncation flags through `handlers.ts`/`buildSmartContext`'s
  return type**, as a cleaner alternative to the text-scrape. Considered and deferred: it would
  touch `SmartContextResult`, every `handleSearch`-adjacent call site, and the MCP tool-result
  shape, for three log fields whose current text-derived version already works and degrades
  safely if it ever stops matching. Worth reconsidering only if `smart-context.ts`'s wording
  changes enough to actually break the match — not preemptively.
- **A `--since`/date-range filter** — `metrics.jsonl` is typically small enough (one line per
  tool call) that reading the whole file and summarizing it is fast; add a filter if a real
  project's log ever makes that not true.

## Design

See Scope. The key call: derive `cacheHit`/`truncated`/`resultNodeCount` from the response text
already computed inside `withMetrics` (`responseText`), rather than restructuring `handlers.ts`'s
return types. `buildSmartContext`'s footer notes (`served from cache`, `truncated to fit token
budget`, `Context includes: N relevant nodes`) are stable, deliberately-worded strings this
codebase already treats as part of its user-facing contract (spec 026's "measured, not asserted"
notes) — reusing them for telemetry costs nothing extra to compute and adds no new coupling
beyond what already existed (`withMetrics` already reads `responseText` to count tokens).

## Acceptance criteria

- [x] `ToolCallMetric`'s five new fields are all optional; an old-format JSONL line still parses.
- [x] `withMetrics` populates `query`/`budgetApplied` from tool arguments and
      `cacheHit`/`truncated`/`resultNodeCount` from the response text, only when applicable
      (verified: a tool with no such concept, e.g. `project_status`, logs none of them).
- [x] `nodum metrics [projectPath]` prints a formatted per-tool summary; `--json` prints valid,
      parseable JSON with the same data.
- [x] A missing metrics log produces a clear error naming the expected path, not a raw ENOENT.
- [x] `npm run build && npm test --workspaces` green; `npx eslint` clean on every new/changed
      file (pre-existing findings in untouched files, e.g. `index.test.ts`'s established
      non-null-assertion test idiom, left as-is per spec 028's documented lint-backlog posture).

## Test plan

`metrics-log.test.ts` (existing, unchanged) — still passes; new fields are optional so existing
fixtures round-trip unaffected.

`index.test.ts` (5 new) — `query`/`budgetApplied` set from `search_graph` args when a
`token_budget` is/isn't supplied; `cacheHit`/`resultNodeCount` derived from a response text
containing the cache-hit and node-count footer phrases; `truncated` derived similarly; a tool
with none of these concepts (`project_status`) logs none of the new fields.

`metrics.test.ts` (new, cli package) — `parseMetricsJsonl`: one-per-line, blank-line skipping,
malformed-line skipping, empty input. `summarizeMetrics`: grouping, call-count sort order,
success rate, p50/p95 duration percentiles, mean-tokens over only the calls that recorded one,
cache-hit/truncation rate scoped to only the calls that reported the field at all (both the
"some reported it" and "none did, so `null`" cases). `metricsCommand`: correct path resolution
from a project path's basename, actionable ENOENT message, non-ENOENT errors re-thrown
unchanged, valid JSON output under `--json`.

## Success Metrics

Real end-to-end verification: built the CLI (`npm run build`), wrote a 4-line `metrics.jsonl`
fixture by hand to `/tmp/nodum-metrics-smoke/.nodum/smoke-proj/logs/metrics.jsonl` (two
`search_graph` calls — one cache hit, one miss — and two `get_node` calls — one success, one
failure), then ran the real built binary:

```
$ NODUM_DATA_DIR=/tmp/nodum-metrics-smoke/.nodum nodum metrics /tmp/nodum-metrics-smoke/smoke-proj
📊 MCP tool call metrics — smoke-proj
Total calls: 4

search_graph
  calls: 2  success: 100%
  duration: p50=12ms  p95=12ms
  mean approx tokens: 95
  cache hit rate: 50%
  truncation rate: 0%

get_node
  calls: 2  success: 50%
  duration: p50=200ms  p95=200ms
  mean approx tokens: 80
```

`--json` produced valid, correctly-typed JSON with the same numbers.

## Related

Depends on: spec 025 (the metrics log this reads), spec 041 (the token-budget/truncation concept
this surfaces). Sibling to specs 063/064 — together the three close the "make the north-star
metric real" arc: 063 for retrieval quality independent of any LLM, 064 for the LLM-facing
end-to-end number, 065 for what real usage actually looked like. Feeds: specs 066-068 can use
`nodum metrics`'s cache-hit rate to sanity-check the hybrid-scoring fix in real sessions, not
just the offline harness.
