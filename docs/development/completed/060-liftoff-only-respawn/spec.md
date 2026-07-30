# 060 — Re-exec with `--liftoff-only` to avoid V8's WASM-optimizer crash

## Status: done

Implemented and tested (4 new unit tests). Full workspace suite green (563 core, 91 mcp, 102 cli,
15 server, 8 benchmarks). **Real check: the exact real ~21,447-file KMP project that crashed Node
`v25.9.0` in ~3 seconds now completes end to end with zero manual flags** — 246,186 real
dependencies, matching every prior real number exactly.

## Goal

Close the "Known issue" ROADMAP.md has carried since spec 055 (v2.12.0): a real large-project sync
crashes Node `v25.9.0` with `Fatal process out of memory: Zone`. Specs 056, 058, and 059 investigated
and fixed two real, separate bugs along the way (a parser resource leak; an array-spread stack
overflow) — but re-verification after spec 059 confirmed neither fix touched this crash. This spec
answers the question those specs left open: is the original crash fixable at all, and if so, how.

## Why now

The user asked to resolve this before scoping any further work, rather than starting new research
with a known crash still open.

## What the investigation found

**Confirmed the crash still reproduces after spec 059's fix**, on a fresh build, identical failure
mode (~2.8s, same `Fatal process out of memory: Zone`).

**Root-caused it to a genuine V8 bug, not to this codebase.** The native stack trace is identical
and unambiguous across every reproduction: `Zone::Expand` → `ZoneVector<StoreObservability>` →
`SnapshotTable::MergePredecessors` → `WasmLoweringReducer` / `MachineOptimizationReducer` →
`CopyingPhaseImpl` → `Pipeline::Run<WasmLoweringPhase>` → `GenerateWasmCode` →
`ExecuteTurboshaftWasmCompilation` → `WasmCompilationUnit::ExecuteCompilation` →
`BackgroundCompileJob::Run`. Every frame is inside V8's Turboshaft WASM *optimizing* compiler,
running on a background compile thread, compiling one of the tree-sitter grammar WASM modules. No
frame is in this codebase, `web-tree-sitter`, or the JS heap — `Zone` is V8's internal compiler
arena, unrelated to `--max-old-space-size`.

**Narrowed the real trigger by elimination, empirically:**
| V8 flag | Result |
|---|---|
| `--wasm-num-compilation-tasks=1` (serialize compilation) | still crashes, ~1.8s |
| `--no-wasm-tier-up` (disable dynamic tier-up) | still crashes, ~1.6s |
| `--liftoff-only` (disallow the optimizing compiler for WASM entirely) | **does not crash** — real full sync completed in ~12 minutes |

`--liftoff-only` forces V8 to only ever use Liftoff (WASM's real production baseline compiler, not a
debug mode) for these grammar modules, so the crashing optimization pass never runs.

**Confirmed the only two "just set an env var" options don't work**, before reaching for a
respawn:
- `NODE_OPTIONS="--liftoff-only"` → rejected outright: `node: --liftoff-only is not allowed in
  NODE_OPTIONS` (Node's flag allowlist).
- `v8.setFlagsFromString('--liftoff-only')` called at process start, before importing anything that
  touches tree-sitter → **still crashes**, identically. WASM compilation tiering is decided too
  early in V8's startup for a runtime flag flip to take effect.

A real process argument, set before V8 initializes, is the only mechanism that works — verified
directly with a working prototype before writing any production code.

## Design

Added `ensureLiftoffOnly()` in `packages/core/src/runtime/liftoff-respawn.ts`, exported from
`packages/core`'s public API. Called as the very first statement (right after the shebang, before
any other import's logic runs) in both `packages/cli/src/bin/nodum.ts` and `packages/mcp/src/index.ts`.

- No-ops when `process.execArgv` already includes `--liftoff-only` — the recursion guard.
- Otherwise `spawnSync`s `process.execPath` with `['--liftoff-only', ...process.execArgv,
  process.argv[1], ...process.argv.slice(2)]` and `stdio: 'inherit'`, then exits with the child's
  status (falling back to `1` if the child was killed by a signal, i.e. `status === null`).

**Lives in `packages/core`, not `packages/cli`.** `packages/mcp` depends on `@caiquebrito/nodum-core`,
not on `packages/cli` — and `packages/mcp/src/handlers.ts` calls the same `syncProject`, so it hits
the identical crash on the identical grammar WASM. Fixing only the CLI would leave a real,
user-facing path (the `sync_project` MCP tool) broken.

**Deliberately no flag-availability probe or fallback.** `--liftoff-only` is a standard V8 flag
that predates Node 18 (this repo's `engines` floor) by several major versions; verified accepted on
both Node `v22.23.1` and `v25.9.0` directly. A pre-flight probe would cost a real ~41ms extra spawn
on every single invocation to guard against a scenario that can't occur on any supported Node
version. If the flag were ever rejected, the failure is loud and immediate (`node: bad option`,
non-zero exit), not silent.

## Out of scope

This is a workaround for an upstream V8 bug, not a fix for it — the bug remains in V8, and this
avoids the specific compilation path that triggers it. `engines: ">=18.0.0"` stays as-is: it was
never narrowed for lack of a Node version that cleanly completed this project, and now one does
(with this fix applied), so there's nothing left to narrow to.

## Acceptance criteria

- [x] `ensureLiftoffOnly()` no-ops when already re-exec'd (verified: no infinite respawn loop).
- [x] Re-execs with `--liftoff-only` prepended to `execArgv`, forwarding the original script path
      and all user arguments, using `stdio: 'inherit'`.
- [x] Propagates the child process's real exit status, including non-zero and signal-killed cases.
- [x] Wired into both `packages/cli/src/bin/nodum.ts` and `packages/mcp/src/index.ts`.
- [x] Real check: the exact real ~21,447-file project completes end to end on Node `v25.9.0` with
      **no manual flag** — 21,447 files, 4,818 functions, 20,151 classes, 246,186 dependencies,
      matching every prior successful (Node 22) run exactly.
- [x] Real check: a non-`sync` command (`nodum status`) behaves identically through the respawn.
- [x] Real check: a deliberately failing sync (`nodum sync /nonexistent/path`) still exits `1`
      through the respawn — status propagation confirmed against a real failure, not just the
      unit test's mock.
- [x] Real check: the compiled MCP server still responds correctly over its stdio transport after
      the respawn — dispatched a real `initialize`, `tools/list`, and `sync_project` tool call
      end to end; the last one performed a genuine sync (parsing, embeddings, graph write) through
      the same respawn mechanism.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

New `packages/core/src/runtime/liftoff-respawn.test.ts` (4 cases), mocking `node:child_process` at
the module level (a `vi.spyOn` on the real built-in's export was tried first and rejected — Node's
ESM built-in module namespace objects aren't consistently re-spyable across tests in this Vitest
setup, throwing `Cannot redefine property: spawnSync`; `vi.mock('node:child_process', ...)` is the
reliable pattern for this). Covers: no-op when the flag is already present; the exact re-exec
argument shape (flag prepended, `execArgv` preserved, script path and args forwarded); propagating
a non-zero child exit status; falling back to exit `1` when the child's status is `null` (signal
kill). `packages/mcp/src/index.test.ts`'s existing `vi.mock('@caiquebrito/nodum-core', ...)` needed
one line added (`ensureLiftoffOnly: vi.fn()`) since the mock is exhaustive and the real module now
exports it.

**Real end-to-end (mandatory, all performed against the real compiled packages, not mocks):**
1. Real full sync of the real ~21,447-file KMP project on Node `v25.9.0`, invoked with zero manual
   flags — completed in ~11m40s, real numbers matching every prior run exactly.
2. `nodum status` (a non-parsing command) — unaffected by the respawn, exits `0`.
3. `nodum sync /nonexistent/path` — a real forced failure, confirmed the process still exits `1`.
4. Spawned the real compiled MCP server as a subprocess, sent real JSON-RPC `initialize` and
   `tools/list` messages over stdin, received well-formed responses over stdout.
5. Sent a real `tools/call` for `sync_project` against a real small project (`packages/cli`) —
   received a real success response with actual file/function/class/dependency counts, confirming
   the respawn doesn't break the MCP stdio transport even mid-parse.

**Not directly observed:** the interactive progress bar's TTY branch (`packages/cli/src/utils/
progress.ts`'s `process.stdout.isTTY` check) — every invocation in this session's environment was
piped or backgrounded, never a real interactive terminal, so `isTTY` was always false regardless of
the respawn. `stdio: 'inherit'` is a direct file-descriptor passthrough (not a new pipe), which by
Node's own documented behavior preserves whatever the parent's stdio actually is, TTY-ness
included — but this is a reasoned expectation from the documented mechanism, not a directly
observed real-terminal check, and is disclosed as such rather than asserted as verified.

## Success Metrics

- Real check: the exact real project that has crashed Node `v25.9.0` since spec 055 (v2.12.0) — and
  survived three prior specs' worth of investigation without a resolution — now completes end to
  end with zero user-facing configuration.
- Real check: root-caused to a genuine upstream V8 compiler bug via elimination against real,
  measured flag combinations, not guessed at from documentation alone.
- Real check: verified the two "cheaper" fixes (`NODE_OPTIONS`, runtime `v8.setFlagsFromString`)
  before committing to the more invasive self-respawn — the respawn is the fix because it's the
  only one that was actually proven to work, not the first one reached for.

## Related

Closes the investigation started in spec 055 (v2.12.0) and continued through specs 056, 058, and
059. This is a workaround for an upstream V8 bug (confirmed via a real, disclosed compiler-internal
stack trace), not a fix merged into V8 itself — worth remembering if a future Node/V8 upgrade
changes this behavior.
