# 059 — Fix `applyExpectActual`'s array-spread stack overflow

## Status: done

Implemented and tested (1 new large-scale regression test). Full workspace suite green (559 core,
91 mcp, 102 cli, 15 server). **Real check: the exact real ~21,447-file KMP project that has never
once fully synced across this entire investigation now completes successfully, end to end, for the
first time** — 246,186 real dependencies, all 18 real `expect`/`actual` pairs confirmed correct.

## Goal

Fix the real, previously-unknown "Maximum call stack size exceeded" bug that spec 056 (v2.13.0)
found but couldn't diagnose, and spec 058 (v2.14.0) made diagnosable by preserving the real stack
trace.

## Why now

Spec 058 shipped specifically to unblock this investigation without another blind multi-hour real
sync. It worked immediately: re-running the exact same real project on Node 22 LTS surfaced the
real stack trace on the first attempt, pointing directly at `packages/core/src/analyzer/
expect-actual.ts:60` — `applyExpectActual`, shipped in spec 055 (v2.12.0). The bug was never in any
tree-sitter parser's recursive AST walk, the candidate ROADMAP.md had speculated about since it had
no real evidence to narrow further; it was a completely different function, in different spec,
found the moment a real stack trace was actually available.

## Scope

- `applyExpectActual`'s edge-array cleanup (clearing stale `'actualizes'` edges before recomputing)
  used `edges.length = 0; edges.push(...preserved);` — spreading a `preserved` array as individual
  `push()` call arguments. On this real project, `preserved` has on the order of 200,000+ elements;
  V8 imposes a real limit on how many arguments a single call can spread, tied to available call
  stack space, and this real project's edge count exceeds it. Replaced with an in-place filter loop
  (`for` + a write-index) that mutates `edges` directly and never spreads an array into a call.
- **Same class of bug spec 052 (v2.11.0) already found and fixed once**, in the same near-duplicate
  grouping code (`Math.min(...similarities)`), but written independently in `expect-actual.ts` a
  batch later without that lesson carrying over. Scanned the rest of the codebase for the same
  pattern (`.push(...`, `Math.min(...`, `Math.max(...`) — confirmed no other live instances remain.

## Out of scope

- The original Node `v25.9.0`-specific V8 WASM out-of-memory crash from spec 055/056 — that crash
  happens during file parsing itself, before `applyExpectActual` ever runs, and is a separate,
  still-unresolved, genuinely Node-version-specific issue. This spec only fixes the second bug that
  crash was masking; it does not make the original project syncable on Node `v25.9.0`.

## Design

Nothing structurally new — a mechanical fix once the real stack trace identified the exact line.
The interesting part is what this confirms about the value of spec 058's own fix: the very first
real re-run with a preserved stack trace found the actual bug in under a minute of reading, after
two prior specs (056, 058 itself) spent real hours investigating a crash whose cause turned out to
be one line, in a completely different file, from a completely different spec, than either had
guessed.

### Real verification found the actual scale, not an estimate

`vv-viaunica-android` (the smaller real project used throughout this investigation, 6,432 files)
has 80,659 edges — already known. This project, at 21,447 files (~3.3x larger), turned out to have
**246,186 edges** once it finally synced — the actual real number the crash was reproducing against,
now confirmed rather than inferred from the smaller project's ratio.

## Acceptance criteria

- [x] `applyExpectActual` no longer spreads a potentially large array into a function call.
- [x] A regression test reproduces the real crash scale (300,000 edges) and confirms it no longer
      throws — verified the *old* code really does crash at this scale first, so the test is a real
      guard, not a trivially-passing one.
- [x] No other live instance of the same spread-into-call-arguments pattern exists elsewhere in the
      codebase (confirmed via a full grep, not assumed).
- [x] Real check: the exact real ~21,447-file project that started this whole investigation (specs
      055, 056, 058) fully syncs end to end for the first time — real node/edge counts, real
      `expect`/`actual` pairing confirmed correct against the same 18-pair result spec 055's smaller
      fixture already established.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

New regression test in `expect-actual.test.ts`: builds a real 300,000-element `Edge[]` array (well
past the real ~246,186-edge scale that reproduced the crash) and asserts `applyExpectActual` no
longer throws and the array is left at the expected length. Verified directly (not assumed) that
the *old* spread-based implementation genuinely throws `RangeError: Maximum call stack size
exceeded` at this scale, via a standalone Node reproduction, before trusting the regression test's
value. Full existing `expect-actual.test.ts` suite (10 cases) unmodified and green.

**Real end-to-end (mandatory):** rebuilt the real packages and re-ran the exact same real
~21,447-file Kotlin Multiplatform project on Node 22 LTS that has never once completed across this
entire investigation (specs 055, 056, 058) — completed successfully end to end for the first time:
21,447 files, 4,818 functions, 20,151 classes, 246,186 dependencies. Confirmed the real synced graph
contains exactly 10 `expect` nodes, 18 `actual` nodes, and 18 `actualizes` edges — identical to spec
055's original smaller-fixture verification, now confirmed against the complete real project rather
than a representative subset.

## Success Metrics

- Real check: a real project that has never once fully synced across three prior specs' worth of
  investigation now completes end to end, with real numbers (246,186 dependencies) confirming the
  scale estimate this whole investigation had been working from.
- Real check: this project's own past lesson (spec 052's `Math.min(...arr)` bug) recurring
  independently in a different file, written by a different spec, is itself evidence worth noting —
  a scanned-for-elsewhere check (not assumed fixed everywhere just because one instance was found)
  confirmed no third occurrence exists.
- Real check: spec 058's stack-trace fix, shipped specifically to make this investigation cheaper,
  worked exactly as intended — the real bug was found and fixed in a fraction of the time either
  prior investigation spent guessing.

## Related

Closes the investigation started in spec 056 (v2.13.0) and continued in spec 058 (v2.14.0). The
original Node `v25.9.0` V8 WASM crash remains a separate, open, unresolved item — this spec fixed
the bug it was masking, not the original crash itself.
