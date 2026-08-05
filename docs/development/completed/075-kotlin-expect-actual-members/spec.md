# 075 — Kotlin expect/actual: tag and link class-body members

## Status: done

Implemented as designed, with one addition beyond the original sketch found necessary during
implementation (the cross-class matching-scope fix was anticipated in Scope but its real necessity
— and a concrete false-positive it prevents — is now verified, not just reasoned about).

`packages/core/src/parser/kotlin.ts`'s class-body member walk now tags each `method` node with a
`platformModifier`: the member's own explicit modifier if present, else inherited from the
enclosing type's already-computed `platformModifier`. One line (`kotlinPlatformModifier(child) ??
platformModifier`) at the existing member-node-building call site — no new parsing logic needed,
`kotlinPlatformModifier` was already generic enough to reuse as-is.

`packages/core/src/analyzer/expect-actual.ts`'s `applyExpectActual` gained a `method`-only
enclosing-type scope check (`buildMethodEnclosingTypeLabels`, one pass over `edges` building a
`Map<methodNodeId, enclosingTypeLabel>` before the existing O(actuals × expects) loop, not a
per-pair lookup inside it — the same "don't turn an O(n) pass into something quadratic" discipline
specs 052 and 059 already established in this exact file). Necessary the moment method nodes can
carry a `platformModifier` at all: module + kind + label alone can't tell two different classes'
same-named members apart.

**Real check, not simulated**: no real KMP project with `expect`/`actual` usage is available on
this machine (the only real Kotlin project present, `vv-viaunica-android`, is a plain Android app
with zero `expect`/`actual` declarations — confirmed by grep before assuming otherwise). Built a
small, realistic fixture matching the exact shape spec 055's own writeup named
(`HttpClientEngineProvider.provideEngine`, `commonMain`/`androidMain`/`iosMain`), ran the real
`nodum` CLI's `sync` command against it (not a unit test), and inspected the real resulting
`graph.json`:
- Both the class-level pair (already worked before this spec) and the new member-level
  `provideEngine` pair produced real `actualizes` edges, for both `androidMain` and `iosMain`
  fulfilling `commonMain`.
- Added a second class (`LoggerProvider`) to the same fixture module, also exposing a
  `provideEngine` member, specifically to exercise the new false-positive risk this spec's own
  change introduces — the real synced graph confirmed each class's member linked only to its own
  counterpart, zero cross-class edges.

## Goal

Close the first of the three real gaps spec 055's own real-world verification found and
deliberately left for a follow-up (`docs/development/ROADMAP.md`'s "Kotlin `expect`/`actual`"
entry under "Next"): a nested declaration inside an `expect`/`actual class` body (the real
verification project's own `HttpClientEngineProvider.provideEngine` case) gets no
`platformModifier` at all today, so it can never produce an `actualizes` edge.

## Why now

The most concrete, smallest, and least-blocked of the three documented gaps (the other two —
top-level property extraction, package-path-aware matching — each need a new parser capability or
further real-world re-verification first). No new prerequisite; extends code that already exists
and already has the enclosing type's own `platformModifier` computed right where the member walk
happens.

## Scope

- `packages/core/src/parser/kotlin.ts`'s class-body member walk (the loop building `method` nodes
  from `function_declaration` children of a `class_body`/`enum_class_body`): tag each member with
  a `platformModifier`, checking the member's own explicit modifier first (real Kotlin code can
  redundantly repeat `expect`/`actual` on a member, and the existing test suite already has a case
  written this way), falling back to the enclosing type's own `platformModifier` when the member
  has none of its own — matching real Kotlin semantics, where a class member is implicitly
  expect/actual by virtue of its enclosing class unless it says otherwise. The real motivating case
  (`HttpClientEngineProvider.provideEngine`) is expected to be exactly this implicit case, not the
  explicit-repeat one, based on general Kotlin style — verify which one the fix actually needs to
  handle rather than assuming.
- `packages/core/src/analyzer/expect-actual.ts`'s `applyExpectActual`: currently matches by
  `module + type + label` only. That was sufficient when no `method`-typed node ever carried a
  `platformModifier` (nothing to match). Once this spec makes that real, two different
  `expect`/`actual class` pairs in the same module with a same-named member method (a real,
  plausible KMP pattern — e.g. two platform-provider classes both exposing `log()`) would
  cross-link incorrectly without also scoping by enclosing class. Add that scoping for `method`-typed
  matches specifically (top-level `function` matches are unaffected — they have no enclosing type
  to disambiguate by in the first place).

## Out of scope

- Top-level property (`val`/`var`) expect/actual detection — needs property node extraction as a
  new parser feature first (a bigger, separate follow-up per the roadmap).
- Package-path-aware matching — flagged in the roadmap as needing re-verification against a second
  real KMP project before treating it as worth building, not attempted here.

## Design

`kotlinPlatformModifier(defNode)` already exists and is reused as-is for the member-level check
(no new logic needed there — it's a generic "does this node have a `platform_modifier` child"
check, already correct for any declaration node, not special-cased to top-level). The inheritance
fallback is one `??` at the call site inside the member loop, using the enclosing type's own
already-computed `platformModifier` value.

For the matching-scope fix: `applyExpectActual` gains a `method`-only enclosing-type lookup, built
once via a single pass over `edges` (a `Map<methodNodeId, enclosingTypeLabel>` from `defines`
edges whose target is a `method`-typed node) — not a per-pair lookup inside the existing
O(actuals × expects) double loop, avoiding the accidental-quadratic-blowup class of bug specs 052
and 059 already found and fixed twice in this exact area of the codebase.

## Acceptance criteria

- [x] A member with its own explicit `expect`/`actual` modifier is tagged (the existing test that
      previously pinned the *old*, wrong behavior was updated as part of this spec, a deliberate,
      disclosed change, not a silent one).
- [x] A member with no explicit modifier, inside an `expect`/`actual class`, inherits the
      enclosing type's `platformModifier`.
- [x] A member inside a plain (non-expect/actual) class remains untagged, unchanged from today.
- [x] `applyExpectActual` links a real member-level expect/actual pair via a new `actualizes` edge.
- [x] `applyExpectActual` does **not** cross-link same-named methods belonging to two different
      classes in the same module — verified by both a unit test and a real synced-graph check
      (`LoggerProvider`/`HttpClientEngineProvider`, both exposing `provideEngine`).
- [x] `npm run build && npm test --workspaces` green — 983 tests total (5 new, all in `packages/core`).

## Test plan

Unit tests in `packages/core/src/parser/kotlin.test.ts` (member tagging, both explicit and
inherited cases, plus a plain-class-stays-untagged control) and
`packages/core/src/analyzer/expect-actual.test.ts` (member-level `actualizes` edge creation, and
the cross-class false-positive guard). `npx eslint` on every touched file reports the identical 24
pre-existing problems before and after this change (confirmed via `git stash` comparison) — zero
new findings.

## Success Metrics

Real, not just unit-level: no real KMP project with `expect`/`actual` usage exists on this machine
(confirmed by grep against the only real Kotlin project present before building a fixture instead
of assuming one existed). Built a fixture matching the exact `HttpClientEngineProvider.provideEngine`
shape spec 055's own writeup named, ran the real `nodum sync` CLI command against it, and inspected
the real `graph.json`: the class-level pair (already worked) and the new member-level pair both
produced real `actualizes` edges for both `androidMain` and `iosMain` fulfilling `commonMain`. A
second class added to the same fixture, sharing a member name, confirmed zero cross-class
false-positive links in the real synced output.

## Related

Follow-up to spec 055 (KMP expect/actual edges, v2.12.0). Named in
`docs/development/ROADMAP.md`'s "Next" section ("Kotlin `expect`/`actual` — real refinements found
during spec 055, deliberately not expanded on") as the first of three documented, deliberately
deferred gaps — this spec closes the first only; top-level property extraction and package-path
matching remain open, tracked there.
