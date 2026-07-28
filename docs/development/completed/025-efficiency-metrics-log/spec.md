# 025 — Per-call efficiency metrics log

## Status: done

Implemented and tested (5 new `packages/core/src/memory/metrics-log.test.ts` cases; full
workspace suite — 196 core, 95 cli, 15 mcp, 306 total — green). Real end-to-end check against
the running MCP server, not just unit tests — see Success Metrics.

## Goal

Make token efficiency observable in **real Claude Code sessions**, not just benchmark runs. 024
gave every MCP context payload a computed `approxTokens` number; this spec makes that number
durable by logging one line per MCP tool call to `~/.nodum/<project>/logs/metrics.jsonl` —
`benchmarks/` measures a 4-file fixture, this measures the repos you actually work in.

## Why now

Directly builds on 024 (needs `countTokens`/`approxTokens` to exist) and is a prerequisite for
026 (needs a real measured baseline to replace the hardcoded percentages with) and 027 (needs a
before/after number on a real session, not only a synthetic fixture, to make its claim credible).

## Scope

- `packages/core/src/memory/metrics-log.ts` (new): `appendMetricsLog(logsDir, metric)`, following
  the same resilience shape as `activity-log.ts`'s `appendActivityLog` — `mkdir` the logs
  directory, best-effort write, swallow failures silently (a metrics write must never break the
  tool call it's measuring). Format is JSONL (one compact JSON object per line, append-only) —
  deliberately not the markdown format `activity.md` already uses, since this is meant to be
  parsed by 028's benchmark tooling later, not read by a human day-to-day.
- **Scope correction from the original plan.** The v2.2.0 plan described this log's fields as
  "tool name, extracted keywords, seed node count, expanded node count, approxTokens, cache
  hit/miss, duration" — but keywords/seed-count/expanded-count/cache-hit are internal to
  `buildSmartContext()` specifically (`search_graph` only), and 024 deliberately kept that
  function's return shape to `{ text, approxTokens }` to stay pure plumbing. Expanding it further
  here would mean redesigning 024's already-merged interface for one spec's logging needs. Instead:
  **instrument generically, once, at the single dispatch point** (`packages/mcp/src/index.ts`'s
  `CallToolRequestSchema` handler) so all 13 MCP tools get logged, not just `search_graph`. Fields:
  `timestamp`, `tool`, `projectName` (when the call has one), `durationMs`, `approxTokens`
  (computed from the response's rendered text — works for any handler, not just
  `buildSmartContext`'s), `success`. Search-specific fields (keywords, seed/expanded counts, cache
  hit) are left for whoever next needs that granularity — likely 027, which already has to touch
  `expandContext()`'s internals.
- `packages/mcp/src/index.ts`: wrap the existing `switch` in the `CallToolRequestSchema` handler
  with a timer and a post-dispatch log call — one instrumentation point covering `sync_project`,
  `project_status`, `get_graph`, `get_node`, `search_graph`, `get_dependencies`,
  `get_dependents`, `analyze_file`, `expand_cluster`, `trace_impact`, `find_bottlenecks`,
  `explain_architecture`, `find_similar_code`, `suggest_refactoring`.
- `packages/mcp/src/handlers.ts`: export the existing `NODUM_DATA_DIR` constant (currently
  private) so `index.ts` can resolve the same `~/.nodum` root without a second definition.

## Out of scope

- Search-specific fields (keywords, seed count, expanded count, cache hit/miss) — see the scope
  correction above. A future spec can extend `buildSmartContext()`'s return shape once there's a
  concrete consumer for that granularity.
- Rotating, truncating, or capping `metrics.jsonl`'s growth — matches how `activity.md` already
  has no cap. Real cap/rotation is a separate concern if it ever becomes one.
- Reading or aggregating the log (a `nodum metrics` command, a dashboard) — this spec only writes
  it. 028's benchmark harness is the first real consumer, and that's its own spec.
- Honoring `NODUM_DATA_DIR` overrides in the MCP path — pre-existing gap (`handlers.ts`'s
  `NODUM_DATA_DIR` is hardcoded to `homedir()/.nodum`, unlike the CLI's env-var-aware resolution
  in `bin/nodum.ts`); not introduced or fixed by this spec, just inherited as-is.

## Design

### 1. `packages/core/src/memory/metrics-log.ts` (new)

```ts
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ToolCallMetric {
  timestamp: string;
  tool: string;
  projectName?: string;
  durationMs: number;
  approxTokens?: number;
  success: boolean;
}

/**
 * Appends one JSONL line per MCP tool call to `<logsDir>/metrics.jsonl`.
 * Best-effort — a failed write must never break the tool call it measures.
 */
export async function appendMetricsLog(
  logsDir: string,
  metric: ToolCallMetric,
): Promise<void> {
  try {
    await mkdir(logsDir, { recursive: true });
    await appendFile(join(logsDir, 'metrics.jsonl'), JSON.stringify(metric) + '\n', 'utf-8');
  } catch {
    // Best-effort — matches appendActivityLog's silent-failure posture.
  }
}
```

### 2. `packages/core/src/memory/index.ts` / `packages/core/src/index.ts`

```diff
+export { appendMetricsLog } from './metrics-log.js';
+export type { ToolCallMetric } from './metrics-log.js';
```

### 3. `packages/mcp/src/handlers.ts`

```diff
-const NODUM_DATA_DIR = join(homedir(), ".nodum");
+export const NODUM_DATA_DIR = join(homedir(), ".nodum");
```

### 4. `packages/mcp/src/index.ts`

```ts
import { appendMetricsLog, countTokens, /* existing imports */ } from "@caiquebrito/nodum-core";
import { /* existing handlers */, NODUM_DATA_DIR } from "./handlers.js";

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const startedAt = Date.now();
  const projectName =
    typeof (args as any).project_name === "string" ? (args as any).project_name : undefined;

  let result: { content: TextContent[] } | { error: string };

  try {
    switch (name) {
      // ...unchanged, except "default" no longer early-returns...
      default:
        result = { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    result = { error: String(error) };
  }

  // Derived from the result shape, not a separate flag — covers both a
  // thrown exception AND a handler's own `{ error }` return (this codebase's
  // dominant failure path; most handlers catch internally and return an
  // error object rather than throwing).
  const success = !("error" in result);
  const responseText =
    "content" in result ? result.content.map((c) => c.text).join("\n") : undefined;

  await appendMetricsLog(join(NODUM_DATA_DIR, projectName ?? "_unscoped", "logs"), {
    timestamp: new Date().toISOString(),
    tool: name,
    projectName,
    durationMs: Date.now() - startedAt,
    approxTokens: responseText ? countTokens(responseText) : undefined,
    success,
  });

  return result;
});
```

`_unscoped` covers the two tools with no `project_name` argument (`sync_project` takes a path,
not a project name until after it runs; `project_status` has none at all) — logged under a fixed
subfolder rather than silently dropped.

## Acceptance criteria

- [x] Every one of the 13 dispatch cases produces exactly one `metrics.jsonl` line, success or
      error — the single instrumentation point covers all of them uniformly, not just the ones
      exercised in the real check.
- [x] A failing tool call (thrown error, or a handler's own `{ error }` return) still logs, with
      `success: false` and no `approxTokens` key.
- [x] `appendMetricsLog` never throws — verified via `metrics-log.test.ts`'s mocked `mkdir`/
      `appendFile` rejection cases (not a literal chmod'd directory, but the same guarantee).
- [x] `NODUM_DATA_DIR` is exported from `handlers.ts` and imported (not redefined) in `index.ts`.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/memory/metrics-log.test.ts` (new) — appends a line and confirms it round-trips
through `JSON.parse`; two appended calls produce two lines, not one overwritten line; a directory
that can't be created (mocked `mkdir` rejection) doesn't throw.

## Success Metrics

- Real check: synced this repo (`nodum sync .` — 132 files, 341 functions), then spoke raw
  stdio JSON-RPC to the compiled `packages/mcp/dist/index.js` server directly (initialize →
  `search_graph` → `get_node` (bad id) → `project_status` → `search_graph` against a
  never-synced project name). Result — `~/.nodum/nodum/logs/metrics.jsonl` has two lines
  (`search_graph`, `get_node`), both `success: true` with plausible `durationMs` (226ms, 3ms)
  and `approxTokens` (849, 12); `~/.nodum/_unscoped/logs/metrics.jsonl` has one `project_status`
  line (no `project_name` arg, correctly bucketed); the deliberately-broken `search_graph` call
  logged under its own project-scoped directory with `success: false` and no `approxTokens` key
  at all (not `approxTokens: 0` — a real failure produces no text to count, not a zero-length
  one).
- **Nuance found, not a bug**: `get_node` on a nonexistent id returns `{ content: [{ text: "Node
  not found: ..." }] }`, not `{ error: ... }` — this codebase already treats "not found" as
  normal content in several handlers, not a protocol-level failure. That call logs
  `success: true`, correctly reflecting that the tool call itself succeeded even though the
  requested node doesn't exist. Not something this spec changes — `success` measures whether the
  *call* worked, not whether the *query* found what it was looking for.

## Related

Depends on: 024 (`countTokens`/`approxTokens`). Blocks: 026 (needs a real baseline to compute
measured savings against), 027 (needs a real-session before/after number, not only a synthetic
fixture).
