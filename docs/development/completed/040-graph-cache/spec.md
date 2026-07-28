# 040 — In-process graph cache

## Status: done

Implemented and tested (7 new cases in `graph-cache.test.ts`; full workspace suite green — 344
core, 95 cli, 67 mcp, 8 benchmarks, 514 total, up from 507 before this spec). Real check: synced a
real project, called two MCP handlers back-to-back, and confirmed via temporary source
instrumentation (added, verified, then reverted before commit — not shipped) that the second call
produced **zero** additional disk reads; then called `handleSync` again and confirmed the next
handler call **did** read fresh — see Success Metrics.

## Goal

Cache a synced project's `graph.json` in-process for the lifetime of the MCP server process,
instead of re-reading and re-`JSON.parse`ing it from disk on every single tool call. First spec
in the v2.8.0 "adaptive context budgeting" batch — ships first because it's the lowest-risk,
highest-value, most isolated change in the batch.

## Why now

`loadGraph()` (`packages/mcp/src/handlers.ts`) had zero caching — a raw `readFile` + `JSON.parse`
on every call, from **11 of 13 MCP tool handlers**. At least one real project's `graph.json` on
disk is 50 MB; that file was being fully re-parsed on every single tool invocation, including two
calls seconds apart in the same conversation turn. `packages/mcp/src/conversation-cache.ts`
already established the exact shape needed for this — TTL-based, per-project-keyed, a
`clearProject()` invalidation hook called from `handleSync` right after a fresh sync — so this
spec is largely "apply an existing, working pattern to a second cache," not new design.

## Scope

- New `packages/mcp/src/graph-cache.ts`: a `GraphCache` class wrapping a
  `Map<string, { graph: Graph; loadedAt: number }>`, a `get(projectName, load): Promise<Graph>`
  method that returns the cached graph on a hit or calls `load()` and caches the result on a miss,
  a `clearProject(projectName)` invalidation method, a `clear()` full-reset method, and a
  process-wide singleton `globalGraphCache` — mirroring `ConversationCache`'s shape and the same
  `5 * 60 * 1000` (5-minute) TTL constant.
- `handlers.ts`: `loadGraph()`'s body now delegates to `globalGraphCache.get(projectName, () =>
  readGraphFromDisk(projectName))`, where `readGraphFromDisk` is the original `readFile` +
  `JSON.parse` logic, renamed and left otherwise unchanged. **This means all 11 read-path
  handlers get caching for free through the one function they already all call** — no need to
  touch each handler individually, a smaller and safer diff than editing 11 call sites.
- `handleSync`: added `globalGraphCache.clearProject(graph.project)` immediately after the
  existing `globalConversationCache.clearProject(graph.project)` call, which itself runs after
  `writeGraphFile` has already persisted the freshly-synced graph — so a subsequent cache
  repopulation reads the new file, not a stale one.
- The `get()` API takes a loader callback rather than hardcoding file-path logic inside
  `GraphCache` itself, keeping disk I/O concerns in `handlers.ts` and making the cache class
  itself trivially unit-testable with a fake loader (no `fs` mocking needed in its own tests).

## Out of scope

- **Cross-process coordination.** The CLI and `packages/server` are separate one-shot/long-lived
  processes with their own uncached reads — untouched by this spec. A known, accepted limitation:
  running `nodum sync` from a separate terminal while the MCP server is open won't be picked up by
  the MCP server until this cache's TTL expires (5 minutes) or the MCP server's own `handleSync`
  runs. Not solved here — coordinating cache invalidation across processes would need a
  file-watcher or IPC mechanism, disproportionate to this spec's scope.
- **Request-coalescing / in-flight-dedup.** If two tool calls for an uncached project arrive
  concurrently, both currently call `load()` independently (last write wins in the cache). MCP
  requests are processed one at a time over stdio JSON-RPC in practice, so this is a real but very
  low-probability race, not addressed here.
- Caching anything other than the parsed `Graph` object itself (e.g. no caching of computed
  analyzer results) — out of scope for this spec.

## Design

`GraphCache.get()`'s callback-based design (`get(key, load)` rather than a pre-registered loader
or hardcoded path) was chosen specifically so the cache class has no `fs`/path dependency at all —
`graph-cache.test.ts` never touches real disk I/O or mocks `readFile`, it just passes a `vi.fn()`
loader and asserts call counts. This is a deliberate departure from `ConversationCache`'s shape
(which has no loader concept at all, just explicit `cacheContext()`/`getRelatedContext()` calls) —
appropriate here because this cache has exactly one read path (`readGraphFromDisk`), unlike
conversation caching's more bespoke similarity-matching logic.

**A real test-isolation issue found and fixed while writing this spec's tests, not before:**
`handlers.test.ts` reuses the project name `"proj"` across 8 separate `describe` blocks, each
mocking different graph content via `readFileMock.mockResolvedValue(...)`. Introducing a
module-level cache singleton would have made later `describe` blocks silently receive stale graph
data cached by an earlier block, despite each block's existing `vi.clearAllMocks()` —
`vi.clearAllMocks()` resets mock call history and implementations, but has no effect on
`GraphCache`'s own internal `Map` state, which is entirely separate module state. Fixed by adding
`globalGraphCache.clear()` alongside every existing `vi.clearAllMocks()` call in
`handlers.test.ts`'s 8 `beforeEach` blocks — verified this was necessary by reasoning through the
existing test file's project-name reuse pattern before writing any cache code, not discovered via
a failing test after the fact.

## Acceptance criteria

- [x] A second call to any of the 11 cached-read handlers for the same project, within the TTL
      and without an intervening sync, does not re-read `graph.json` from disk.
- [x] `handleSync` invalidates the cache for the synced project immediately, so the very next
      handler call reads the fresh graph, not a stale cached one.
- [x] Two different projects' caches are independent — clearing or expiring one never affects the
      other.
- [x] `handlers.test.ts`'s existing 8 `describe` blocks, which all reuse the project name `"proj"`
      with different mock data each, continue to pass unmodified in their assertions (only their
      `beforeEach` gained one line).
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/mcp/src/graph-cache.test.ts` (7 cases, no `fs` mocking needed): loader called on a
cache miss; loader not called again on a cache hit; two projects cached independently; loader
re-invoked after `clearProject()` for that project only, leaving the other project's cache intact;
loader re-invoked for every project after `clear()`; loader re-invoked once the TTL has expired
(`vi.useFakeTimers()`); the *second, distinct* value returned by the loader after
`clearProject()` is actually the new one, not a lingering stale reference. `handlers.test.ts`'s
existing 16 tests pass unmodified after adding `globalGraphCache.clear()` to each `beforeEach`.

## Success Metrics

- Real check: synced a real one-file TypeScript project with the CLI, then — via temporary
  `console.error` instrumentation added directly to `readGraphFromDisk` (verified, then reverted;
  never shipped) — called `handleSearch` → `handleGetGraph` → `handleSearch` again. Actual
  output: exactly **one** "disk read" log line, for the first call; the second and third calls
  produced none, confirming the cache hit path runs end-to-end through the real handler dispatch,
  not just the isolated unit test. Then called `handleSync` on the same project and one more
  `handleGetGraph`: a fresh "disk read" log line appeared, confirming `handleSync`'s invalidation
  call actually takes effect on the very next handler call.

## Related

First of three specs in the v2.8.0 "adaptive context budgeting" batch. Independent of 041 (token
budget) and 042 (parallel discovery + parser safety fix) — no shared code with either. Reuses
`conversation-cache.ts`'s established TTL-cache pattern (no prior spec number — predates the
spec-numbering convention) rather than inventing a new one.
