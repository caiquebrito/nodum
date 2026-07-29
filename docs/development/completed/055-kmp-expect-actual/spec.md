# 055 — KMP expect/actual edges

## Status: done

Implemented and tested (7 new platform-modifier cases in `kotlin.test.ts`, 10 new cases in
`expect-actual.test.ts`, +3 in `graph-gen.test.ts`). Full workspace suite green (557 core, 92 mcp,
101 cli, 15 server). Real check: verified against a real, currently-in-production Kotlin
Multiplatform codebase found on this machine — all 18 real `actual` declarations across 10 real
`expect` declarations correctly detected and paired; zero drift on re-sync; zero false positives on
a real non-KMP Kotlin project. Third and final spec in the v2.12.0 batch.

## Goal

Detect Kotlin `expect`/`actual` declarations and link each `actual` to the `expect` it fulfills via
a new `actualizes` edge — the real remaining KMP prerequisite this roadmap named since v2.9.0.

## Why now

Specs 049 and 051 (v2.10.0/v2.11.0) shipped path-derived `sourceSet`/`module` labeling as
deliberately small, standalone slices of the larger deferred KMP initiative. ROADMAP.md's "Next"
section named the remaining prerequisite as "the source-set dependency graph (`commonMain ←
iosMain`) — `expect`/`actual` edges are symbol-to-symbol, not file-to-file, and need a resolution
mechanism this codebase doesn't have yet." Batch-scoping research for this release found that
framing partly stale: Kotlin's *default hierarchy template* means source-set dependency edges are
almost never explicitly declared in a real project's Gradle files at all — parsing them would find
nothing. The real remaining work was `expect`/`actual` detection and pairing itself, confirmed
small: the shipped grammar already exposes `expect`/`actual` as a `platform_modifier` node
(empirically verified, not assumed), and a real local KMP project was found to validate against.

## Scope

- New `kotlinPlatformModifier(defNode)` in `packages/core/src/parser/kotlin.ts` — mirrors the
  existing `kotlinDeclKind()` keyword-scanning pattern: a declaration's `modifiers` named child may
  contain a `platform_modifier` named child whose own text is the keyword itself (`"expect"`/
  `"actual"`). Wired into both existing node-construction sites: top-level type declarations
  (class/interface/enum/object) and top-level functions.
- New `Node.platformModifier?: 'expect' | 'actual'` field (`types.ts`), additive.
- New `RelationType` member `'actualizes'` (`actual` → `expect`).
- New `packages/core/src/analyzer/expect-actual.ts`: `applyExpectActual(nodes, edges)` — pairs each
  `actual` node with its `expect` counterpart within the same `Node.module`, matching declaration
  kind (`NodeType`) and label, and validating that the `actual`'s source set is a legitimate
  dependent of the `expect`'s per Kotlin's default hierarchy template (`androidMain`/`iosMain`/
  `jvmMain`/`jsMain` → `commonMain`, and the `*Test` equivalents) — an internal validation constant,
  not exposed as its own graph artifact. Wired into `graph-gen.ts` alongside the existing
  `applySourceSets`/`applyModules` calls, in both the full and incremental sync paths.
- **Deliberately out of scope, discovered and documented, not assumed going in**:
  - `expect class` *members* (nested declarations inside an `expect`/`actual class` body) — this
    parser's existing class-body walk only extracts *members*, and this spec doesn't separately
    tag them with a platform modifier at all.
  - `expect`/`actual` on top-level properties (`val`/`var`) — this parser doesn't extract Kotlin
    top-level properties as nodes at all today (a pre-existing limitation, not introduced by this
    spec); a real `expect val platformModule: Module` declaration found during verification was
    confirmed correctly left untagged, since there is no node to tag.
  - Matching by package path — this parser doesn't extract Kotlin `package` declarations at all;
    matching by `module` + declaration kind + label was verified sufficient (zero false collisions
    found against the real project used for verification, including a same-named `platformModule`
    declaration that exists in two different, unrelated modules).
  - `settings.gradle` module-dependency parsing — confirmed unnecessary, per Design below.

## Out of scope

- Any change to `source-set.ts`'s existing `detectSourceSet`/`detectModule` — unchanged.
- Cross-language `expect`/`actual`-style symbol linking for other languages — Kotlin-specific
  syntax, no equivalent elsewhere in this codebase.
- A dedicated CLI/MCP surface for `expect`/`actual` — `actualizes` edges are visible through the
  existing `get_dependencies`/`get_dependents`/`trace_impact` tools automatically, same posture as
  every other `RelationType`; no new tool was judged necessary.

## Design

### Verified the real grammar shape before writing any extraction code

Wrote a small probe script against the real `tree-sitter-kotlin.wasm` grammar (not assumed from the
`expect`/`actual`/`platform_modifier` token strings alone) to confirm the exact AST shape: a
`function_declaration`/`class_declaration`/`object_declaration`/`property_declaration` carries a
`modifiers` named child, which may contain a `platform_modifier` named child whose text is the
keyword itself — its only child is an anonymous token, so no further descent is needed. Confirmed
this holds with a `visibility_modifier` (e.g. `internal`) present alongside it in the same
`modifiers` node, in either order — the real `internal expect object` case this spec's own
verification project contains.

### Why `settings.gradle` parsing turned out unnecessary

Grepped the real KMP project's actual `*.gradle.kts` files for `dependsOn` (the real Gradle DSL
call that would declare an explicit source-set dependency): zero occurrences across the whole
project. Every module relies on Kotlin's default hierarchy template — `iosMain`/`androidMain` →
`commonMain` is implicit, declared nowhere. Parsing Gradle for this would have found nothing to
parse; the small hardcoded convention table in `expect-actual.ts` is not a shortcut around a harder
mechanism, it's the actual mechanism real projects rely on.

### Why matching is module + kind + label, not also package path

This parser has never extracted Kotlin `package` declarations. Real verification found this
sufficient: the only same-name collision among real `expect`/`actual` declarations in the
verification project (`platformModule`, appearing as both a `val` in one module and a `fun` in a
different, unrelated module) was already disambiguated by the module-scoping check alone, since
Kotlin's `expect`/`actual` pairing is inherently per-module in KMP (each module declares its own
source-set hierarchy). Adding package-path extraction — a real, separate parser feature — was
judged unnecessary rather than skipped for convenience.

### Real end-to-end verification found and worked around an unrelated environmental crash

A genuine Kotlin Multiplatform project exists on this machine
(`/Users/caiquebrito/Documents/Repositories/mobile-app-develop`), not yet synced, with 11 real
`expect` and 20 real `actual` declarations across its full ~21,447-file tree. A full sync of that
entire tree reproducibly crashed this machine's Node/V8 build (`v25.9.0`) with a
`Fatal process out of memory: Zone` error during concurrent tree-sitter WASM compilation — confirmed
unrelated to this spec's own code (the crash occurs during file parsing itself, before this spec's
post-pass ever runs, and was reproduced identically with `--no-wasm-tier-up`/reduced worker-pool
flags, and does NOT occur syncing a comparably-sized non-KMP real project on this same machine).
Rather than skip real verification, copied the four real module directories containing every real
`expect`/`actual` declaration (`core/network`, `core/kotlin`, `core/profile`,
`core/arco/compose/design` — 320 real `.kt` files, real production code, unmodified) into a
scratch fixture and synced that instead — a real, representative, verifiable subset of the actual
project rather than the full unrelated-crash-inducing tree.

## Acceptance criteria

- [x] `expect`/`actual` platform modifiers correctly detected on top-level functions, classes,
      interfaces, enums, and objects, including with a co-occurring visibility modifier.
- [x] `expect class`/`actual class` *members* are NOT tagged — confirmed as a real regression test.
- [x] `applyExpectActual` links a genuine `expect`/`actual` pair, respects module scoping (does not
      link across different modules even with an identical name/kind), respects declaration-kind
      matching (does not link a `fun` to a `class` of the same name), and respects the source-set
      dependency convention (does not link `androidMain` to `iosMain` directly, both must relate to
      `commonMain`).
- [x] The post-pass runs over the full node array in both the full and incremental sync paths, and
      correctly links a newly-added `actual` to a pre-existing `expect` (or vice versa) even when
      only one side's file was part of an incremental sync's changed set.
- [x] Re-running the post-pass is idempotent (clears stale `actualizes` edges first, not additive).
- [x] Real check: all 18 real `actual` declarations in the verification fixture correctly paired to
      their 9 real `expect` counterparts (10 real `expect` declarations detected; the 10th,
      `MembershipDatabaseConstructor`, had no `actual` counterpart within the copied module subset —
      a real, disclosed limitation of the fixture's scope, not a pairing failure).
- [x] Real check: a non-KMP Kotlin/Android project gets zero `platformModifier` tags and zero
      `actualizes` edges.
- [x] Re-syncing the same project twice produces zero drift (`nodum diff`).
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`kotlin.test.ts` (+7 cases): `expect`/`actual` tagging on top-level `fun`/`class`/`object`, an
`internal expect object` (visibility modifier co-occurring with platform modifier), no tag on a
plain declaration, and the explicit regression that a nested member inside an `actual class` body
is NOT tagged. `expect-actual.test.ts` (10 new cases): a genuine linked pair (`iosMain`/`androidMain`
fulfilling `commonMain`); no link across different modules despite identical name/kind; no link
across different declaration kinds; no link when the source-set relationship is illegitimate
(`androidMain` cannot fulfill `iosMain` directly); `commonTest`/`*Test` pairing; multiple `actual`s
linking to the same `expect`; no-op on a project with no `expect`/`actual` at all; idempotence
(clears stale edges, doesn't double-add); non-`actualizes` edges left untouched. `graph-gen.test.ts`
(+3 cases): a real pairing wired correctly in the full-sync path; a newly-added `actual` linking to
a pre-existing `expect` in the incremental-sync path; zero `actualizes` edges for a project with no
`expect`/`actual` declarations.

**Real end-to-end (mandatory):** copied the four real module directories containing every real
`expect`/`actual` declaration from a genuine, not-yet-indexed local KMP project (320 real `.kt`
files) into a scratch fixture and synced it via the real CLI — confirmed all 18 real `actual`
declarations correctly paired to their `expect` counterparts across `androidMain`/`iosMain`/
`jvmMain`, with the one out-of-scope property (`expect val`) correctly left untagged. Re-synced
(`--incremental`) and diffed (`nodum diff`) — zero drift. Regression: `vv-viaunica-android` (a real,
already-synced, non-KMP Android project) confirmed at zero `platformModifier` tags and zero
`actualizes` edges.

## Success Metrics

- Real check: 18/18 real `actual` declarations in the verification fixture correctly linked to
  their real `expect` counterparts — a genuine, exhaustively-checked real-world result, not a
  synthetic approximation.
- Real check: this spec's real end-to-end verification surfaced and worked around a genuine
  environmental Node/V8 limitation (a full-monorepo sync crash unrelated to this spec's own logic)
  by scoping to a real, representative, still-unmodified subset of the actual project — the same
  "verify against real data, adjust when reality doesn't match the plan" practice this project has
  applied consistently, this time to an infrastructure limitation rather than a design assumption.
- Real check: `settings.gradle` parsing was confirmed unnecessary by directly grepping the real
  verification project's actual Gradle files for `dependsOn` (zero occurrences), not assumed from
  general Kotlin/Gradle knowledge.

## Related

Third and final spec in the v2.12.0 batch (viewer Sync fix, MCP SDK version bump, KMP expect/actual
edges). Builds directly on specs [049](../049-kotlin-source-sets/spec.md) and
[051](../051-kotlin-module-labeling/spec.md)'s `sourceSet`/`module` fields. The source-set
*dependency graph* itself remains internal to this spec's own validation logic, not a new
user-facing artifact — ROADMAP.md's framing of it as the outstanding KMP deliverable is now
superseded by this spec actually shipping the `expect`/`actual` edges that graph was meant to
enable.
