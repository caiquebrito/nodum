# 076 — Kotlin expect/actual: package-path-aware matching

## Status: refined — not started

## Goal

Close the second of the two still-open Kotlin `expect`/`actual` gaps named in
`docs/development/ROADMAP.md`'s "Next" section: `applyExpectActual`
(`packages/core/src/analyzer/expect-actual.ts`) matches an `actual` to its `expect` by
`module + declaration kind + label` only, with no awareness of Kotlin `package` at all — because
this parser has never extracted a Kotlin `package` declaration as data on any node, for any
purpose. Spec 055 verified this scope reduction "sufficient" against exactly one real KMP project,
and flagged directly in the roadmap that this was a **single-project, not-yet-generalized**
finding, worth re-checking before being treated as settled.

## Why now

The class-body-member gap (the other of the three original spec-055 follow-ups) closed in spec
076's predecessor, 075. Of the two gaps left, top-level-property detection needs a genuinely new
parser capability (Kotlin top-level `val`/`var` node extraction) with no existing partial
support to build on. This one doesn't — `kotlin.ts` already parses a per-file `rootNode` once
(`parse()`, line 98) and already extracts one other per-file, syntax-derived fact from it
(`extractImports(root)`, line 376); a `package` declaration is the same shape of fact, at the
same extraction point. Smallest, least-blocked of the two remaining items, matching the same
"pick the least-blocked deferred item" reasoning spec 075 itself used to get picked up.

**Re-verification finding, done as part of writing this spec, not deferred to implementation
time:** searched every repository on this machine for a second real KMP project to verify
against (`find ~/Documents/Repositories -maxdepth 1`; grepped every `.kt` file across all of them
for `expect fun|expect class|expect val|actual fun|actual class|actual val`). Result: **no second
real KMP project with real `expect`/`actual` usage exists on this machine** — the same
`vv-viaunica-android` project spec 075 already found is a real, large (11,399-file) Android
codebase, confirmed again here to contain zero `expect`/`actual` declarations. This is the same
constraint spec 075 hit and disclosed, not a new problem — real end-to-end verification for this
spec will need a purpose-built fixture, same as spec 075's own `HttpClientEngineProvider` fixture,
rather than a second genuine project.

**However, the risk itself is not merely hypothetical — it's directly readable in the current
code.** `applyExpectActual`'s matching loop
(`packages/core/src/analyzer/expect-actual.ts`, the `for (const actual of actuals)` block) checks
only `actual.module !== expect.module`, `actual.type !== expect.type`, `actual.label !== expect.label`,
and (since spec 075) enclosing-type for `method` nodes — there is no package check anywhere in the
file, because no node carries a package at all. Any real project with two same-kind,
same-simple-name `expect` declarations in *different packages* but the *same Gradle module* (e.g.
`com.app.network.Config` and `com.app.storage.Config`, both `expect class Config` in the same
module's `commonMain`) would silently cross-link today. This is a real, demonstrable gap in the
current matching logic, not a speculative "what if" — this spec's real verification step exists to
confirm it end-to-end (not just by code reading) before fixing it, per this project's standing
practice of verifying against real synced output rather than reasoning alone.

## Scope

- Verify the real `tree-sitter-kotlin.wasm` grammar's package-declaration shape with a small probe
  script before writing any extraction code (the same practice spec 055 used to confirm
  `platform_modifier`'s real shape rather than assuming it from the token name alone). Kotlin's
  grammar is expected to expose a `package_header` node with a `identifier`-shaped child holding
  the dotted path, directly under the file's `rootNode` — confirm this holds, including the
  no-package-declaration case (a real, legal Kotlin file with no `package` line at all, which must
  extract as "no package," not error).
- New `kotlinPackageName(root: TSNode): string | undefined` in `packages/core/src/parser/kotlin.ts`,
  called once per file (mirroring `extractImports(root)`'s existing call shape at the top of
  `parse()`), not per-declaration — a Kotlin file has exactly one package for every declaration in
  it.
- New `Node.package?: string` field in `packages/core/src/types.ts`, additive, stamped onto every
  node `kotlin.ts` constructs for a file that has one (top-level types, top-level functions, and
  class-body `method` nodes all inherit the same file-level package — there is no per-declaration
  override in Kotlin the way `platformModifier` has one).
- `applyExpectActual`: add a package-equality check to the existing match conditions
  (`actual.package !== expect.package` → skip), alongside the existing module/kind/label checks.
  Nodes with no `package` (a real Kotlin file legally has none in the default/root package) match
  only against other package-less nodes in the same module/kind/label — not treated as a wildcard.
- Real end-to-end verification: build a fixture with two `expect class`/`actual class` pairs
  sharing the same simple name, same Gradle module, same source sets, but declared in two
  different packages — sync it with the real CLI, inspect the real `graph.json`, and confirm (a)
  before this spec's fix, the false cross-link reproduces exactly as predicted by the code-reading
  above, and (b) after the fix, each `actual` links only to the `expect` in its own package.

## Out of scope

- Top-level property (`val`/`var`) `expect`/`actual` detection — still needs top-level-property
  node extraction as its own parser feature first, unrelated to package extraction; remains the
  one open item this spec doesn't touch.
- `settings.gradle`/`build.gradle.kts` parsing — spec 055 already confirmed real KMP projects rely
  on Kotlin's default hierarchy template rather than explicit `dependsOn` declarations; nothing
  about package-path matching changes that finding.
- Nested/relative package resolution, package aliasing, or `import` shadowing — Kotlin's own
  resolution rules for these are non-trivial; this spec only needs literal package-string equality
  between an `actual` and the `expect` it's meant to fulfill, which is the real, universal Kotlin
  convention (an `actual` declaration lives in the same package as its `expect`, only under a
  different source-set directory) — not general package resolution.
- Any change to `resolveJvmImport`/`resolveImport` — those already resolve dotted-FQN import
  *specifiers* against file paths; this spec adds a *declaration's own* package as node data, a
  different, unrelated mechanism reusing none of that code path.

## Design

### Extraction point

`kotlin.ts`'s `parse()` already computes one `root = tree!.rootNode` per file and already derives
one other whole-file fact from it inline (`extractImports(root)`, called once, its result reused
across the file). `kotlinPackageName(root)` follows the identical shape: called once near the top
of `parse()`, its result (`packageName: string | undefined`) captured in a local variable and
spread onto every node object this file's `parse()` call constructs, the same way
`group: getNodeGroup(file.path)` is already spread onto every node today. No new per-node lookup,
no new pass over `nodes` after the fact — package is known before any node is built, unlike
`sourceSet`/`module` (which are path-derived and applied via a separate post-pass in
`graph-gen.ts` because they don't require parsing file *content*, only the file *path*). Package
does require parsing content, so it belongs at the same point `platformModifier`/`label` already
get decided, not a separate post-pass.

### Matching change

`applyExpectActual`'s existing four-part check (`module`, `type`, `label`, and the spec-075
enclosing-type check for `method` nodes) gains one more equality check: `package`. Structured the
same way the existing checks are — an early `continue` in the double loop, not a new data
structure, since package (unlike the spec-075 enclosing-type map) is already a plain field
directly on each `Node`, needing no `defines`-edge traversal to look up.

### Why this shouldn't wait for a second real project

Spec 055's own finding was explicitly scoped as "sufficient for the one real project checked," not
"sufficient in general" — and the roadmap has carried it as an open re-verification item since
v2.12.0 for exactly that reason. A second real KMP project doesn't exist on this machine to check
against (confirmed above), and there's no basis to assume one will appear before this gap causes a
real false-positive `actualizes` edge on some other real project. Given the risk is already
demonstrable by reading the matching code directly — not merely plausible — fixing it now with a
fixture-verified test is more consistent with this project's practice than leaving a known,
reasoned-through gap open indefinitely waiting for verification data that may never arrive. This
mirrors spec 075's own posture: it also had no real KMP project with `expect`/`actual` usage
available and built a fixture instead of waiting.

## Acceptance criteria

- [ ] The real `tree-sitter-kotlin.wasm` grammar's package-declaration shape is confirmed via a
      probe script (not assumed) before extraction code is written, including the no-package-line
      case.
- [ ] `kotlinPackageName(root)` correctly extracts a real dotted package path (e.g.
      `com.app.network`) from a file that declares one, and returns `undefined` for a file that
      doesn't.
- [ ] Every node `kotlin.ts` builds for a file (top-level types, top-level functions, class-body
      methods) carries that file's `Node.package` when one exists, and none when it doesn't.
- [ ] `applyExpectActual` does **not** link an `actual` to an `expect` of the same module, kind,
      and label when they're declared in two different packages.
- [ ] `applyExpectActual` still correctly links a genuine same-package pair — no regression on
      every existing passing case in `expect-actual.test.ts` (including the spec-075 method/
      enclosing-type cases, which have no package set in today's fixtures and must keep matching
      when both sides are equally package-less).
- [ ] Real, fixture-based end-to-end check: a fixture with two same-name/same-kind `expect`/
      `actual` pairs in two different packages, same module, reproduces the false cross-link
      *before* this spec's fix and is confirmed corrected *after* it, via a real `nodum sync` and
      direct `graph.json` inspection (not a unit test standing in for this check).
- [ ] `npm run build && npm test --workspaces` green, zero new ESLint findings on touched files
      (compared via `git stash`, matching spec 075's own verification method).

## Test plan

Unit tests in `packages/core/src/parser/kotlin.test.ts`: package extraction from a file with a
`package` declaration, a file without one, and a file with a multi-segment dotted path. Unit tests
in `packages/core/src/analyzer/expect-actual.test.ts`: a new case asserting no link forms between
same-module/same-kind/same-label `expect`/`actual` nodes when their `package` fields differ, and a
control case confirming existing package-less fixtures still link exactly as before.

**Real end-to-end (mandatory, matching this project's standing practice):** build a small fixture
with two Kotlin classes sharing a simple name (e.g. `Config`) in different packages
(`com.app.network`/`com.app.storage`), both declared `expect class Config { ... }` in the same
module's `commonMain`, each with an `actual class Config` in `androidMain` and `iosMain`. Run the
real `nodum` CLI's `sync` against this fixture on the pre-fix code and confirm the false cross-link
predicted by the Design section actually appears in the real `graph.json`. Apply the fix, re-sync,
and confirm each `actual` now links only to the `expect` in its own package — 4 correct
`actualizes` edges (2 packages × `androidMain`+`iosMain`), zero incorrect ones.

## Success Metrics

Real, not just unit-level: confirm via a real synced `graph.json`, both before and after the fix,
that the package-collision false positive the Design section predicts from direct code inspection
is real (not merely theoretical) before this spec's fix, and gone after it — the same "verify the
predicted bug actually reproduces before trusting the fix" discipline spec 059 applied to the
array-spread stack overflow and spec 052 applied to the `Math.min(...array)` crash.

## Related

Second of the two remaining Kotlin `expect`/`actual` gaps named in `docs/development/ROADMAP.md`'s
"Next" section (the third, class-body members, closed in
[075](../../completed/075-kotlin-expect-actual-members/spec.md)). Builds on
[055](../../completed/055-kmp-expect-actual/spec.md)'s `applyExpectActual` and
[075](../../completed/075-kotlin-expect-actual-members/spec.md)'s enclosing-type matching, adding
package as a third disambiguating axis alongside module and enclosing type. Once this ships, the
only open Kotlin `expect`/`actual` gap left is top-level-property detection, which needs its own
new parser capability first.
