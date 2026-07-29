# 042 — Parallel file discovery, parser safety fix, sync guardrails

## Status: done

Implemented and tested (8 new cases across `base.test.ts`, `file-discovery.test.ts`, and
`scan-config.test.ts`; full workspace suite green — 352 core, 95 cli, 77 mcp, 8 benchmarks, 532
total, up from 524 before this spec — every pre-existing assertion passes unmodified). Real check:
synced a frozen snapshot of a real project (`packages/core` at HEAD) before and after this spec's
changes and diffed `graph.json` — byte-for-byte identical, including cluster assignment and node
order. Separately synced a hand-built fixture with one oversized file via the real CLI and
confirmed it's excluded with a warning, not a crash or a silently-truncated sync. See Success
Metrics.

## Goal

Parallelize file-discovery I/O with bounded concurrency, fix a latent tree-sitter parser safety
issue before any future work relies on it, and add file-size/file-count guardrails — none existed
before this spec. Third of three specs in the v2.8.0 "adaptive context budgeting" batch.

## Why now

File discovery (`readFile`+`stat`+hash per file) was fully sequential despite being genuinely
I/O-bound work that yields the event loop — a real, safe wall-clock win going unclaimed.
Separately, `TreeSitterParser.ensureReady()` memoized an entire `loadGrammar()` result — including
its one fresh `TSParser` — for the lifetime of each parser instance, safe today only because
`parser.parse()` happens to never yield mid-call; that fragility would have silently corrupted
results the moment any future concurrent-parsing work (e.g. real `worker_threads` parallelism)
reused the same instance across overlapping calls. And no project size guardrails existed at all —
an oversized file or a huge file count had no path to a graceful, visible warning; only a full read
attempt or a silent slowdown.

## Scope

- **Bounded-concurrency file discovery.** `file-discovery.ts`'s `walkFiles` split into two phases:
  `collectFileEntries` (sequential recursive `readdir`, unchanged in behavior — just collects
  matching `{ fullPath, relativePath, ext }` entries instead of calling a visitor inline) and a
  hand-rolled `mapWithConcurrency(items, concurrency, fn)` utility (no new dependency) that runs
  `fn` over the collected entries with at most 8 in flight at once. `discoverFiles` and
  `discoverChangedFiles` both call `collectFileEntries` then `mapWithConcurrency` over the result.
  Order is preserved (`results[index] = await fn(items[index])`, not push-on-completion), so
  downstream node/edge generation — which depends on file processing order for stable IDs and
  cluster assignment — is unaffected by which file's I/O happens to finish first.
- **`TreeSitterParser.ensureReady()` simplified to a direct passthrough.** `base.ts` no longer
  memoizes `loadGrammar()`'s result at all — `loadGrammar()` (`treesitter/engine.ts`) already does
  the right thing itself: a memoized, genuinely-immutable `Language` (safe to share), and a fresh
  `TSParser` bound to it on every call. The old `private ready: Promise<LoadedGrammar> | null`
  field was redundant on top of that and is removed outright, not just relaxed.
- **`tree.delete()` added to all 5 tree-sitter-backed parsers** (`python.ts`, `java.ts`,
  `javascript.ts`, `swift.ts`, `objc.ts`), right before each one's `return { nodes, edges, imports
  }` — frees the WASM-allocated tree once node/edge extraction has copied everything it needs into
  plain `Node`/`Edge` objects. Verified safe: `ParseResult` only ever contains plain
  strings/numbers, never a live `TSNode` reference, so nothing outlives the `delete()` call.
- **File-size and file-count guardrails.** `ScanConfig` (`scan-config.ts`) gains two new optional
  fields, following the exact same pattern as `ignoredDirs`: `maxFileSizeBytes` (default 2 MB,
  exported as `DEFAULT_MAX_FILE_SIZE_BYTES`) — a file over this is excluded individually, with a
  warning, not read or parsed; `maxFilesWarning` (default 20,000, exported as
  `DEFAULT_MAX_FILES_WARNING`) — a project with more discovered files than this gets one warning,
  the sync still runs on all of them (this project's established "no silent caps" practice — see
  spec 028's benchmark suite and prior specs' Design sections).
- **`onWarning?: (message: string) => void` callback**, threaded through the same pattern already
  established for `onParseProgress`/`onClusterProgress`/`onStep`: `DiscoveryOptions` (new, on
  `discoverFiles`/`discoverChangedFiles`) → `GenerateGraphOptions.onWarning` → `SyncHooks.onWarning`
  → the CLI's `sync` command (`console.warn`) and the MCP server's `handleSync` (collected and
  appended to the tool response text as a `⚠️ Warnings:` block, so a client sees them without
  needing to read server stderr).

## Out of scope

- **No `worker_threads` redesign.** Parsing itself (`parser.parse()`) is synchronous, CPU-bound
  work in every language parser — wrapping it in `Promise.all` does not parallelize it, only
  reorders microtasks on the same thread with zero wall-clock benefit (confirmed directly by
  reading `python.ts`/`swift.ts`/`typescript.ts` during this batch's planning). Real parse-time
  throughput requires actual OS threads, a much larger redesign this spec deliberately defers.
  `graph-gen.ts`'s `parseFilesInto` therefore stays a sequential `for` loop over files — a
  deliberate scope decision, not an oversight.
- **No CLI flags for the new guardrail fields.** `maxFileSizeBytes`/`maxFilesWarning` are only
  settable via `.nodumrc.json`, same as `ignoredDirs` today has no dedicated `nodum config` flag
  either — consistent with the existing config surface, not a gap introduced by this spec.
- **`Query` object sharing across parser instances** — left as-is (queries are cached per
  `(language, name)` pair in `engine.ts`'s `getQuery`, unchanged by this spec). Verified empirically
  via a disposable scratch script (see Design) that concurrent `matches()` calls against different
  `Tree`s from a shared `Query` object produce correct, non-cross-contaminated results, and that
  calling `tree.delete()` on one tree doesn't corrupt matches already computed against another —
  so no further change was needed here.

## Design

### The tree-sitter safety fix is a one-line simplification, not a redesign

Reading `treesitter/engine.ts`'s `loadGrammar()` closely (rather than assuming the fix would need
new caching logic) showed it already constructs a fresh `TSParser` per call, bound to a `Language`
memoized in a module-level `Map` keyed by grammar file. `base.ts`'s own `private ready` field was
redundant on top of that — it cached the *whole* `loadGrammar()` result, including that first
`TSParser`, forever, defeating the "fresh parser per call" property `loadGrammar()` already
provided. The fix is therefore to delete `base.ts`'s memoization layer entirely and let
`ensureReady()` delegate straight through — not to add anything.

### Empirical verification before committing to the design

Per this project's established practice of not trusting undocumented third-party behavior (the
pinned `web-tree-sitter@0.25.10`'s `Query.matches()`/`Tree.delete()` semantics aren't fully spelled
out in its docs), a disposable scratch script was run before writing any production code:
constructed two parsers of the same language, parsed two different sources, ran `q.matches()`
against both trees concurrently via `Promise.all` on a *shared* `Query` object, and confirmed each
call's captures matched only its own tree (no cross-contamination). Then called `tree.delete()` on
one tree and re-ran `matches()` against the *other*, still-live tree, confirming it still returned
correct results — deleting one tree doesn't invalidate a shared `Query`'s ability to match against
a different, still-live tree. This confirmed `Query` objects can safely stay shared as they already
are, and that `tree.delete()` is safe to call once a parse's node/edge extraction is done.

### Discovery parallelization required no change to downstream consumers

`discoverFiles`/`discoverChangedFiles` return the same `FileInfo[]` / `DiscoveryDiff` shapes as
before, in the same order — `mapWithConcurrency` writes results by index, not push-on-completion,
so nothing downstream (node ID generation, cluster assignment, which both depend on stable file
processing order) needed to change. This was verified directly, not just assumed: the real-CLI
check below diffs a full `graph.json` — including `clusters`/`nodeToCluster` — byte-for-byte
between the pre- and post-spec code on the same frozen input.

## Acceptance criteria

- [x] `discoverFiles`/`discoverChangedFiles` process files with bounded concurrency; output (file
      set, hashes, order) is unchanged from the sequential version on a real fixture.
- [x] `TreeSitterParser.ensureReady()` no longer holds its own memoized `Promise` — verified by a
      concurrency regression test (`Promise.all` of many `parse()`-equivalent calls on one
      instance) producing correct, non-corrupted per-call results.
- [x] All 5 tree-sitter-backed parsers call `tree.delete()` after extraction, verified by the full
      existing parser test suites (192 tests across the 5 languages) still passing unmodified.
- [x] A file over `maxFileSizeBytes` is excluded individually, with a warning — the rest of the
      sync completes normally, not aborted or silently truncated.
- [x] A project over `maxFilesWarning` files gets exactly one warning; every file is still
      discovered and synced (warn-only, no truncation).
- [x] Warnings reach both the CLI (`console.warn`) and the MCP server (`handleSync`'s response
      text) via the same callback-threading pattern as existing `SyncHooks` callbacks.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`base.test.ts` (+1 case): concurrent `parse()`-equivalent calls on one `TreeSitterParser` instance
produce correct, non-corrupted results per call — the regression test the old design's fragility
would have failed. `file-discovery.test.ts` (+4 cases): 30-file fixture exercising multiple
concurrency batches, each file's content/hash verified against its own path, not a neighbor's; an
oversized file excluded with a warning while the rest of the sync proceeds; no warning when every
file is within limits; a file-count-over-threshold warning fires without excluding anything.
`scan-config.test.ts` (+3 cases): `maxFileSizeBytes`/`maxFilesWarning` load and save correctly
alongside existing fields; non-numeric values are ignored rather than accepted.

## Success Metrics

- Real check: synced a frozen `git archive` snapshot of `packages/core` at HEAD — a real ~80-file
  TypeScript project — with the pre-spec-042 build and again with the post-spec-042 build. The
  resulting `graph.json` files are byte-for-byte identical after normalizing key order, including
  `clusters` and `nodeToCluster` (i.e. bounded-concurrency discovery didn't just produce the same
  *set* of files, but the same downstream node order and cluster assignment). Wall-clock for both
  runs was comparable at this project's size (~80 files, sub-second either way) — the concurrency
  win is real but modest at this scale; it matters more on larger projects, where I/O latency
  (not CPU) dominates discovery time.
- Real check: a hand-built fixture with one file 323 bytes against a configured
  `maxFileSizeBytes: 200` synced via the real CLI — the oversized file was skipped with a printed
  `⚠️ Skipped huge.ts (323 bytes, over the 200-byte guardrail)` warning, and the sync otherwise
  completed normally (the other file was discovered, parsed, and included).

## Related

Third of three specs in the v2.8.0 "adaptive context budgeting" batch. Independent of 040 (graph
cache) and 041 (token budget) — no shared code with either. Closes out v2.8.0; see `ROADMAP.md` for
the batch's full scope and the deferred real parse-time parallelism / true modularity clustering
follow-ups this batch intentionally left for a future release.
