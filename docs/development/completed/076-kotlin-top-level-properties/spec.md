# 076 — Kotlin: extract top-level properties as nodes, detect their expect/actual pairing

## Status: done

Implemented as designed, no deviations. `packages/core/src/types.ts` gained `'property'` on
`NodeType`; `packages/core/src/parser/kotlin.ts`'s existing top-level `property_declaration` walk
now also pushes a real `'property'` `Node` (id/label/file/group/line/`platformModifier`, via the
already-generic `kotlinPlatformModifier` helper — no changes needed there) and a `fileId ->
propertyId` `'defines'` edge, alongside the unchanged `declaredTopLevelNames` collection.
`expect-actual.ts` needed zero changes, confirming the design's core bet: `applyExpectActual`
already matches generically by `module + type + label` with no `function`/`class`-specific
assumption, so a `'property'`-typed node flows through the exact same path.

One real bug this spec's own `npm run build` caught before any test ran:
`packages/lsp/src/graph-utils.ts`'s `SYMBOL_KIND_BY_NODE_TYPE` is a `Record<Node["type"],
SymbolKind>` — adding `'property'` to `NodeType` made that mapping non-exhaustive
(`TS2741: Property 'property' is missing`), a real downstream consumer this spec's own Scope
section hadn't named. Fixed with one line (`property: SymbolKind.Property`) — LSP already has a
dedicated `SymbolKind.Property`, no fallback-to-closest-kind judgment call needed (unlike the
pre-existing `protocol`/`extension` mappings this file's own comment documents). A repo-wide
`grep` for other `Record<NodeType, ...>` / `Record<Node["type"], ...>` shapes found this was the
only one.

**Real check, not simulated**: no real KMP project with `expect`/`actual` *property* usage exists
on this machine (same situation specs 055/075 document — the only real Kotlin project present,
`vv-viaunica-android`, has zero `expect`/`actual` declarations of any kind). Built a two-file
fixture (`expect val platformModule: Module` in `app/src/commonMain/kotlin/Platform.kt`,
`actual val platformModule: Module = Module()` in `app/src/androidMain/kotlin/Platform.kt`), ran
the real built `nodum` CLI (`packages/cli/dist/bin/nodum.js sync`) against it, and inspected the
real resulting `graph.json` directly: both sides produced a real `'property'`-typed node with the
correct `platformModifier`/`sourceSet`/`module`, and a real `actualizes` edge
(`...androidmain..._platformmodule -> ...commonmain..._platformmodule`) linked them —
`applyExpectActual` needed no code change to produce it. Full workspace suite (`npm run build` +
`npm test` from repo root) green across all 8 workspaces (743 tests total, up from 741 pre-spec —
core alone: 612, up from 610).

## Goal

Close the second of the three real gaps spec 055's own real-world verification found and
documented in `docs/development/ROADMAP.md`'s "Kotlin `expect`/`actual`" entry under "Next":
`expect`/`actual` on a top-level property (`val`/`var`) can't be detected today, because this
parser has never extracted Kotlin top-level properties as graph nodes at all — the real
verification project's own `expect val platformModule: Module` declaration was confirmed
correctly left untagged only because there is no node to tag.

## Why now

The other still-open item in that same roadmap entry (package-path-aware matching) needs
re-verification against a second real KMP project before it's even worth building — a research
question, not an implementation one. This one has a concrete, scoped implementation path with no
unbuilt prerequisite of its own: add one new `NodeType`, extract it the same way every other
top-level declaration already is, and reuse `applyExpectActual` as-is (it already matches
generically by `type`/`label`/`module`/`sourceSet`, with no `function`/`class`-specific
assumption).

## Scope

- `packages/core/src/types.ts`: add `'property'` to `NodeType`.
- `packages/core/src/parser/kotlin.ts`: the existing top-level `property_declaration` walk
  (currently only harvests the name into `declaredTopLevelNames`, deliberately emitting no `Node`
  — see that loop's own comment) additionally creates a real `'property'` node — id, label, file,
  group, line, and `platformModifier` via the existing `kotlinPlatformModifier` helper (already
  generic, no changes needed there) — plus a `fileId -> propertyId` `'defines'` edge, matching
  every other top-level declaration's edge shape. `declaredTopLevelNames` keeps collecting the
  name exactly as before — `usedBySamePackageSibling` in `dead-code.ts` already unions
  `declaredTopLevelNames` with real node labels for the same file, so a property having a real
  node now is additive, not a behavior change for that analyzer.
  - Constants (`val x = 1`, no explicit type, `expect`/`actual` never legitimately applies) still
    get a node — matching every other declaration kind here, which extracts unconditionally and
    just leaves `platformModifier` unset when absent. No filtering by mutability or by
    presence of a modifier.
  - `var` and `val` are both `property_declaration` in this grammar — no distinction needed for
    node extraction; scoped to whatever the grammar itself hands back.
- `packages/core/src/analyzer/expect-actual.ts`: no change. `applyExpectActual` already filters by
  `platformModifier` presence and matches by `module + type + label` — a `'property'`-typed node
  flows through the exact same generic path a `'function'`-typed one does today. The `method`-only
  enclosing-type-label check added in spec 075 is explicitly conditioned on `actual.type ===
  'method'`, so it's inert for `'property'` — matching top-level functions/classes/interfaces/
  enums today, and correct here for the same reason (a top-level property has no enclosing type to
  disambiguate by).

## Out of scope

- Package-path-aware matching — still flagged in the roadmap as needing re-verification against a
  second real KMP project before it's worth building; unrelated to this spec's own change.
- Property extraction for any other language's parser — Kotlin-only, matching how spec 055/075's
  own `expect`/`actual` work was scoped (a Kotlin/KMP-specific language feature).
- Class-body (member) property extraction — the existing top-level-only walk this spec extends
  deliberately stays top-level-only; a class-body `val`/`var` member is a materially different
  grammar shape (inside `class_body`, not a direct child of `source_file`) and isn't named by any
  real gap the roadmap documents. Not attempted here.
- Any new `Graph['stats']` field for the new node type (e.g. a `properties` count alongside
  `functions`/`classes`) — `graph-gen.ts`'s `buildStats` isn't touched; not needed to make
  expect/actual detection work, and adding it isn't this spec's job.

## Design

`kotlin.ts` already has a top-level `property_declaration` loop (the one whose comment currently
reads "deliberately not extracted as their own `Node`"). That comment and its rationale
(`declaredTopLevelNames` was enough for same-package dead-code resolution) predates this spec —
`applyExpectActual` now gives a second, independent reason a property needs a real node. The loop
gains the same shape as the adjacent top-level-function loop just above it in the same file: read
the `simple_identifier` name (already being read for `declaredTopLevelNames`), compute
`platformModifier` via the existing `kotlinPlatformModifier(defNode)` helper (already declared
generic over any node with a `modifiers` child — no change needed), build a `normalizeNodeId(file.path,
name, 'property')` id, push the `Node` and the `'defines'` edge. No duplicate-hash / complexity /
cognitive-complexity fields — a property has no body to measure, matching how a field-less
declaration is handled nowhere else in this parser (there's no existing property-like precedent to
match against; this is the first).

## Acceptance criteria

- [x] A top-level `expect val platformModule: Module` and a same-module `actual val
      platformModule: Module = ...` produce a `'property'`-typed node each, with `platformModifier`
      set to `'expect'`/`'actual'` respectively, and `applyExpectActual` links them with an
      `'actualizes'` edge — no changes needed in `expect-actual.ts` itself for this to work.
- [x] A plain top-level `val`/`var` with no platform modifier still gets a `'property'` node (no
      `platformModifier` field), and `declaredTopLevelNames` still includes its name unchanged.
- [x] The pre-existing test asserting "no property Node created" for a plain top-level `val` is
      updated to assert the opposite, disclosed as a deliberate, known behavior change (matching
      spec 075's own precedent for updating a test that pinned old behavior) — not silently left to
      fail.
- [x] Full existing `packages/core` suite stays green apart from that one disclosed update.

## Test plan

- `packages/core/src/parser/kotlin.test.ts`: extend the existing "KotlinParser expect/actual
  platform modifiers" describe block with top-level `expect val`/`actual val` cases (mirroring the
  existing `expect fun`/`actual fun` cases just above them), and update the "declaredTopLevelNames"
  describe block's "no property Node created" case.
- `packages/core/src/analyzer/expect-actual.test.ts`: one new case constructing two `'property'`-
  typed nodes (same module, `expect`/`actual`, matching label) and asserting the `'actualizes'`
  edge appears — proving the existing generic matching logic needs no change, not just asserting
  it by reading the code.
- Real check: sync a small fixture (`expect val`/`actual val` pair across `commonMain`/`androidMain`,
  same shape as spec 055/075's own `HttpClientEngineProvider` fixture) with the real `nodum` CLI and
  inspect the resulting `graph.json` for the real `'property'` nodes and `'actualizes'` edge — the
  same "real CLI + real graph.json inspection" discipline specs 055/075 both used, since no real KMP
  project with `expect`/`actual` property usage exists on this machine to verify against directly.

## Success Metrics

Not a ranking/retrieval or token-cost change — no `retrieval-eval.ts`/`benchmarks/harness.ts`
before/after applies. Success is the acceptance criteria above: real `expect val`/`actual val`
pairs produce a real `'actualizes'` edge where today none is possible.

## Related

- `docs/development/completed/055-kotlin-expect-actual-kmp/spec.md` — original `expect`/`actual`
  detection, this spec's direct prerequisite context.
- `docs/development/completed/075-kotlin-expect-actual-members/spec.md` — the sibling gap (class-
  body members) this spec's roadmap entry was grouped with, closed first because it needed no new
  parser capability.
- `docs/development/ROADMAP.md`'s "Kotlin `expect`/`actual`" entry under "Next" — the source of
  this spec's scope.
