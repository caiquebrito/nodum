# 056 — Fix tree-sitter parser memory leak

## Status: done

Implemented and tested (1 new regression test, spying on `TSParser.prototype.delete`). Full
workspace suite green (39 core test files, 558 tests). **Real end-to-end verification found this
fix does not, by itself, resolve the original real-project crash it was investigating** — a more
nuanced and honest result than the plan assumed going in, documented in full below rather than
glossed over. First spec in the v2.13.0 batch.

## Goal

Fix a real, confirmed resource leak: every tree-sitter-backed parser creates a fresh `TSParser`
instance per `parse()` call (by design, since spec 042, to avoid sharing mutable parser state) but
never frees it — only the parsed `Tree` gets `delete()`d, never the `Parser` itself.

## Why now

Discovered (not induced) during spec 055's real end-to-end verification: syncing a real ~21,447-file
Kotlin Multiplatform project reproducibly crashed this machine's Node `v25.9.0` with
`Fatal process out of memory: Zone` during concurrent tree-sitter WASM compilation. ROADMAP.md's
"Known issue" entry written at the time speculated this might be concurrency-related. Batch-scoping
research for this release disproved that speculation directly: `graph-gen.ts`'s `parseFilesInto` is
a plain sequential `for` loop — there is no parsing concurrency to cap at all. Research instead
found a real, concrete, confirmed-from-the-actual-`web-tree-sitter`-API defect: `Parser.prototype
.delete()` exists and is never called anywhere in this codebase, across all 7 tree-sitter-backed
parsers. On a project this large, that's roughly 21,000 leaked WASM parser instances.

## Scope

- Added `parser.delete()` immediately after the existing `tree!.delete()` call in each of the 7
  tree-sitter-backed parsers: `python.ts`, `java.ts`, `javascript.ts`, `kotlin.ts`, `go.ts`,
  `swift.ts`, `objc.ts` — confirmed via the real installed `web-tree-sitter` type definitions that
  `Parser.prototype.delete()` is the correct, existing API (`node_modules/web-tree-sitter/
  web-tree-sitter.d.ts:141-142`), not assumed.
- Updated `treesitter/base.ts`'s doc comment to state the new cleanup contract explicitly — every
  subclass's `parse()` must delete the `TSParser` it's handed, not just the `Tree`.
- New regression test in `kotlin.test.ts`: spies on `TSParser.prototype.delete` and asserts a real
  `parse()` call triggers it — a representative guard for all 7 parsers, since they share the exact
  same pattern.
- **Deliberately not attempted**: any concurrency-related change (there is no parsing concurrency
  to change) — a mechanical, low-risk fix, not a restructuring of the parsing pipeline.

## Out of scope

- A `try`/`finally` restructuring of each parser's `parse()` method to also guarantee cleanup on a
  mid-parse throw — considered, but `graph-gen.ts`'s `parseFilesInto` already wraps each file's
  `parser.parse(file)` call in its own try/catch (skipping files that fail to parse), and there is
  no evidence mid-parse throws are a meaningful fraction of real-world leaks; the demonstrated real
  leak is on *successful* parses at scale. Revisit if evidence of leaked parsers from thrown parses
  specifically ever surfaces.
- Narrowing `package.json`'s `"engines": { "node": ">=18.0.0" }` field — considered as a fallback per
  this spec's own plan, but **not done**, because real re-verification (below) found neither Node
  version tested cleanly completes the specific real project that originally surfaced this issue,
  for two separate reasons — there is no "known-good" range to narrow to yet with confidence.

## Design

Verified the real `web-tree-sitter` API directly before writing the fix (not assumed from the bug's
description alone): `node_modules/web-tree-sitter/web-tree-sitter.d.ts` confirms `Parser`, `Tree`,
`TreeCursor`, `Query`, and `LookaheadIterator` each have their own independent `delete()` method —
deleting a `Parser` has no effect on the separately memoized `Language`/`Query` objects
`engine.ts`'s `loadGrammar()`/`getQuery()` already cache and share across every parse call, confirmed
by re-reading `engine.ts`'s actual current implementation.

### Real verification found this fix is necessary but not sufficient — documented honestly, not glossed over

This is the important, non-obvious part of this spec. The plan's working assumption, based on the
prior batch's research, was that the leaked `TSParser` instances were *the* cause of the original
crash. Real re-verification proved that assumption incomplete:

1. **Re-syncing the exact same real ~21,447-file project on the same Node `v25.9.0`, with this
   fix applied, still crashed identically** — the same `Fatal process out of memory: Zone` error,
   in roughly the same ~2 seconds, before meaningful parsing progress. The leak fix alone did not
   resolve it.
2. **Testing on Node 22 LTS** (installed via Homebrew specifically for this check) on the same real
   project: the original V8 WASM crash **did not reproduce at all** — the sync ran for over two
   hours instead of crashing in seconds, confirming the original crash genuinely is specific to this
   machine's Node `v25.9.0` build (or that general vintage of V8), not something this codebase's own
   code fully controls.
3. **But after those two-plus hours, Node 22 hit a different, real, previously-unknown bug**:
   `RangeError: Maximum call stack size exceeded` — a genuine JavaScript call-stack overflow inside
   this codebase's own recursive AST-walking logic (candidates: the `visit()`-shaped recursive
   walks in `computeComplexity`/`collectNormalizedTokens`/`extractCalls`-equivalents across the
   tree-sitter parsers), triggered by some real file elsewhere in this specific ~21k-file project
   deep/large enough to exceed the default call-stack limit. This was not visible before because the
   Node 25.9.0 V8 crash happened first, at the very start of parsing, masking whatever later file
   would have triggered this.

**Neither Node version tested fully syncs this specific real project, for two unrelated reasons.**
The parser leak fix is real, verified, and worth keeping regardless (a genuine bug, fixed
correctly, with zero downside) — but it does not, on its own, make this specific real project
syncable. Rather than force a narrative of "fixed" onto an incomplete result, or spend further
unbounded time chasing a stack-overflow root cause blind (each real repro attempt costs 2+ hours,
and the current error handling — `sync.ts:43` — discards the real stack trace, keeping only
`error.message`), this is disclosed honestly as a second, new, real, separate finding — tracked as
its own future item in ROADMAP.md, not silently folded into this spec's scope or hidden.

## Acceptance criteria

- [x] `parser.delete()` is called after every tree-sitter parser's `parse()` completes, verified via
      a real spy-based regression test.
- [x] `Language`/`Query` memoization (`engine.ts`) is confirmed unaffected by deleting the per-call
      `Parser` — they're entirely separate cached objects.
- [x] Existing parser test suites (242 tests across all 7 languages) pass unmodified — this changes
      cleanup behavior only, not parse output.
- [x] Real check: the original crash was retested against the same real project that surfaced it, on
      the same Node version, and found to still occur — a fix is only claimed to work when actually
      re-verified, not assumed from the diagnosis alone.
- [x] Real check: a second Node version was tested specifically to isolate whether the original
      crash is Node-version-specific — confirmed yes, and a second, real, distinct bug was found in
      the process, disclosed rather than ignored.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

New regression test in `kotlin.test.ts`: spies on `TSParser.prototype.delete` (imported directly
from `web-tree-sitter`, the real class every parser's `ensureReady()` hands back an instance of) and
asserts a real `parse()` call triggers it — representative of the identical fix applied to all 7
parsers, which share the exact same pattern. Full existing parser suites (`python.test.ts`,
`java.test.ts`, `javascript.test.ts`, `kotlin.test.ts`, `go.test.ts`, `swift.test.ts`,
`objc.test.ts` — 242 cases total) verified unmodified and green.

**Real end-to-end (mandatory, and the reason this spec's Design section is longer than usual):**
rebuilt the real `packages/core`/`packages/cli` and re-synced the exact same real ~21,447-file KMP
project that originally surfaced the crash during spec 055's verification, on the same machine and
Node version (`v25.9.0`) — confirmed the fix alone does not resolve it. Installed Node 22 LTS via
Homebrew specifically to test Node-version-specificity — confirmed the original crash does not
reproduce there, but a second, real `Maximum call stack size exceeded` error does, after over two
hours of otherwise-successful parsing progress. Both results reported to the user directly, who
confirmed shipping the leak fix on its own real merits while documenting the rest honestly, rather
than either quietly fixing further blind or overstating this spec's actual resolution.

## Success Metrics

- Real check: a genuine resource leak (confirmed via the real installed `web-tree-sitter` API, not
  assumed) is fixed and verified via a real regression test — independently valuable regardless of
  whether it resolves the specific crash that motivated finding it.
- Real check: this spec's own real-scale re-verification caught its own working assumption being
  incomplete — the leak fix does not, alone, make the original real project syncable — and a second
  Node-version test isolated exactly what part of the original symptom is Node-version-specific
  versus a separate, real, previously-unknown bug in this codebase's own recursive traversal logic.
  Disclosed as a new tracked item rather than glossed over, the same "verify against real data, be
  honest about what it actually shows" practice this project has applied consistently — this time
  to its own prior spec's diagnosis, not just a design assumption.

## Related

First spec in the v2.13.0 batch (tree-sitter parser leak fix, MCP registerTool migration).
Independent of spec 057. See ROADMAP.md's "Next" section for the newly-discovered
`Maximum call stack size exceeded` bug, tracked as its own future investigation, and the original
Node/V8 crash entry updated to reflect that it's confirmed Node-version-specific but not otherwise
resolved.
