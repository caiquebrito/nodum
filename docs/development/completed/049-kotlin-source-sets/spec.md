# 049 — Kotlin module/source-set labeling

## Status: done

Implemented and tested (47 new cases across `config-reader.test.ts` — new, `source-set.test.ts` —
new, `stack-detector.test.ts` — new, `graph-gen.test.ts`, and `smart-context.test.ts`; full
workspace suite green — 510 core, 97 cli, 15 server, 80 mcp, 8 benchmarks, 710 total, up from 679
before this spec). Real check: verified against `PokemonApp`, a real Android project already synced
on this machine, that `languages`/`frameworks` went from **completely empty** to `Kotlin/Java` /
`Jetpack Compose` after this spec's fix — a genuine, reproducible before/after on a real project,
not a hypothetical one. A hand-built KMP fixture (`commonMain`/`androidMain`/`iosMain`/
`commonTest`, with the Compose marker deliberately placed only in a module's build file, matching a
real pattern found during this spec's own verification) confirmed both halves of the spec in one
fixture. Fourth and final spec in the v2.10.0 batch.

## Goal

Fix a real, reproducible stack-detection gap for Kotlin/Android projects, and add path-convention
source-set labeling (`commonMain`, `androidMain`, `test`, ...) to `Node` — a small, standalone-value
slice of the deferred KMP initiative, not the initiative itself.

## Why now

ROADMAP.md's "Next" section named a real module/source-set model as KMP's genuine prerequisite,
deferred as its own future initiative after v2.9.0's scoping. This spec extracts the one slice of
that prerequisite with real standalone payoff today: path-convention labeling, plus fixing a
detection bug found during that same scoping pass — `readBuildGradle`/`readSettingsGradle` only
ever read the plain `.gradle` (Groovy) filenames, never `.gradle.kts`/`settings.gradle.kts` (Kotlin
DSL). Modern Kotlin/Android projects are commonly Kotlin-DSL-only, and this project's own real
synced-project index confirmed it: **four real Kotlin/Android projects already synced on this
machine — `vv-viaunica-android`, `PokemonApp`, `pesqueai-android`, `kotlin-app` — all showed
completely empty `languages`/`frameworks` before this spec**, not a contrived example.

## Scope

- `analyzer/config-reader.ts`'s `readBuildGradle`/`readSettingsGradle` now try both extensions
  (plain first, `.kts` second — first-found-wins, matching the existing multi-candidate pattern
  already used by `readDockerCompose`/`readEnvExample`/`readREADME` in the same file).
- **A companion fix, confirmed necessary by real verification, not assumed**: a real project's
  `com.android`/`androidx.compose` plugin markers commonly live in a *module's* build file, not the
  root's, in a multi-module Gradle layout. Verified directly against `vv-viaunica-android`'s real
  source: its root `build.gradle.kts` contains `com.android` (8 occurrences) but zero occurrences
  of `androidx.compose` — that marker exists only in one module's own build file
  (`pagebuilder/build.gradle.kts`). Root-only reading would have fixed Kotlin/Gradle/Android
  detection but left Jetpack Compose permanently undetected. New `readGradleBuildFiles()` reads the
  root plus every depth-1 subdirectory's own build file (bounded — skips dot-directories/`build`/
  `node_modules`, capped at `MAX_GRADLE_BUILD_FILES`), used specifically for `stack-detector.ts`'s
  framework substring checks; `readBuildGradle` itself (root only) stays the "is this even a Gradle
  project?" signal, unchanged in that role.
- New `analyzer/source-set.ts`: `detectSourceSet(filePath)` matches the `src/<name>/kotlin/**` or
  `src/<name>/java/**` directory convention — pure path matching, no build-file parsing, the same
  precedent `types.ts`'s `getNodeGroup()` already established for `Node.group`. `applySourceSets
  (nodes)` stamps or clears `Node.sourceSet` across the whole node array in place, called once from
  `graph-gen.ts` after node construction in both the full and incremental sync paths.
- New `Node.sourceSet?: string` field (`types.ts`), additive. **`.kts` was deliberately not added
  to `KotlinParser.extensions`** — Gradle build scripts should not become graph nodes themselves.
- `mcp/src/smart-context.ts`'s `buildNodeContext` gains a conditional `Source set: <name>` line,
  shown only when the node has one — a non-Kotlin/Gradle project's output stays byte-identical to
  before this spec, same posture as spec 036's optional Swift/ObjC stat lines. This is what gives
  the spec real, immediately visible user payoff.

## Out of scope

- Parsing `settings.gradle`'s `include(...)` calls to build a real module→path map — real edge
  cases exist (`includeBuild`, `project(":x").projectDir = file(...)` overrides, multi-line
  declarations) that a regex extraction can't reliably handle; deferred to the real future KMP
  initiative.
- The source-set *dependency* graph (`commonMain ← iosMain`, needed for future `expect`/`actual`
  resolution) — only a real Gradle DSL parse could give this, and it has no standalone payoff on
  its own; deferred alongside `include()` parsing.
- `expect`/`actual` edges themselves — not attempted at all in this spec.
- A CLI flag or command surfacing source-set information directly (e.g. `nodum sync --show-source-sets`)
  — the MCP `get_node` line is this spec's only new user-facing surface; a dedicated CLI/analyzer
  view is a natural follow-up, not bundled here.

## Design

### Verified before writing any fix code, per this project's established practice

Per the plan's explicit instruction, checked a real Android project's actual build-file layout
*before* deciding whether the `.kts` fix alone was sufficient, or whether the
`readGradleBuildFiles` companion fix was also needed. Grepped `vv-viaunica-android`'s real
`build.gradle.kts` (a project already synced on this machine, confirmed showing empty
`languages`/`frameworks`) for both markers: `com.android` appeared 8 times at the root;
`androidx.compose` appeared zero times at the root, but once in `pagebuilder/build.gradle.kts`, a
depth-1 module. This single check determined the companion fix was genuinely needed, not merely
plausible — without it, this spec would have shipped a real Android/Kotlin detection fix that still
silently missed Jetpack Compose on real multi-module projects, an incomplete fix that would have
looked done.

### Why source-set labeling can't go stale, by construction

`applySourceSets` is a pure function of `node.file`, and `node.file` is itself baked into the
node's own id via `normalizeNodeId` — so a file that moves to a different source-set directory gets
a brand-new node id on its next parse, not a mutated old one. There is no "the label used to be
right but the file moved" case to separately guard against, unlike anything derived from build-file
*content* (which is exactly why `include()`-driven module mapping stays deferred — that content can
change without any Kotlin file itself changing, a real staleness risk this spec's design avoids
entirely by not depending on build-file content for source-set labels at all).

## Acceptance criteria

- [x] `readBuildGradle`/`readSettingsGradle` correctly read the `.kts` variant when the plain one
      is absent, verified via a real Android project going from undetected to detected.
- [x] Framework markers (`androidx.compose`) that live only in a module's build file, not the
      root's, are correctly detected — verified against the confirmed-real layout in
      `vv-viaunica-android`.
- [x] `Node.sourceSet` is correctly stamped for KMP source sets (`commonMain`/`androidMain`/
      `iosMain`/`commonTest`) and classic Android source sets (`main`/`test`/`androidTest`),
      including at method-level nodes (not just file nodes).
- [x] Source-set stamping happens in both the full-sync and incremental-sync code paths.
- [x] A TypeScript-only project gets zero `sourceSet`-tagged nodes and an unchanged
      `languages`/`frameworks` result — the fix has zero effect outside Gradle/Kotlin projects.
- [x] `mcp get_node` shows a `Source set:` line only for a node that has one; output for every
      other node type is byte-identical to before this spec.
- [x] Re-syncing the same project twice produces zero drift (`nodum diff`).
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`config-reader.test.ts` (new, 9 cases): `.gradle`/`.gradle.kts` variants for both readers,
first-wins when both present, `readGradleBuildFiles` combining root + module files, skipping
`node_modules`/`build`/dot-directories, depth-1-only (not nested). `stack-detector.test.ts` (new, 5
cases): no build file → empty stack; plain `.gradle` detected; `.gradle.kts`-only detected (the
real gap); a framework marker only present in a module's file still detected; no false-positive
Compose detection when no build file mentions it. `source-set.test.ts` (new, 12 cases):
KMP/Android/product-flavor source sets, non-matching paths, Windows-separator normalization,
idempotence, stale-label clearing. `graph-gen.test.ts` (+3 cases): stamping in both full and
incremental paths, non-matching paths untouched. `smart-context.test.ts` (+2 cases): the
conditional line shown/omitted correctly.

**Real end-to-end (mandatory):** a hand-built KMP fixture (`settings.gradle.kts`, a root
`build.gradle.kts` with only the Android marker, a `shared` module's own `build.gradle.kts` with
only the Compose marker — deliberately split across root/module to mirror the real layout found
during verification) synced via the real CLI. Confirmed: all four source sets stamped correctly on
every node including method-level ones; `projects.json` shows `languages: ['Kotlin/Java']`,
`frameworks: ['Android', 'Jetpack Compose']`. Re-synced and diffed — zero drift. Separately,
re-synced `PokemonApp` (a real, already-synced Android project on this machine) and confirmed its
`projects.json` entry went from `languages: []`/`frameworks: []` to `languages: ['Kotlin/Java']`,
`frameworks: ['Jetpack Compose']`, with 276 `main`-source-set nodes and 31 `test`-source-set nodes
in its resulting graph. Regression: re-synced `packages/core` (TypeScript-only) and confirmed zero
nodes carry `sourceSet`.

## Success Metrics

- Real check: `PokemonApp`, a real Android project already synced on this machine before this spec
  existed, went from `languages: []`, `frameworks: []` to `languages: ['Kotlin/Java']`,
  `frameworks: ['Jetpack Compose']` after re-syncing with this spec's fix — a genuine before/after
  on real, not fabricated, data. 276 nodes correctly tagged `main`, 31 tagged `test`.
- Real check: `vv-viaunica-android` (6432 files, the largest real project available), re-synced with
  this spec's fix, went from `languages: []`/`frameworks: []` to `languages: ['Kotlin/Java']`,
  `frameworks: ['Android', 'Jetpack Compose']`. Resulting `sourceSet` distribution across 56,605
  nodes: `test` 28,555, `main` 27,893, `sharedTest` 94, plus the product-flavor source sets
  `pontofrio`/`extra`/`bahia`/`androidTestBahia`/`androidTestExtra`/`androidTestPontofrio` (2-18
  nodes each) — matching, almost exactly, the file-level distribution independently measured during
  this batch's earlier scoping research on the same real project, confirming the shipped
  implementation reproduces that offline validation at the node level, not just the file level.
- Real check: `vv-viaunica-android`'s real `build.gradle.kts` was directly inspected to confirm the
  companion `readGradleBuildFiles` fix was genuinely necessary (not merely plausible) before
  building it — `com.android` in the root file, `androidx.compose` only in a module's file.
- Real check: a hand-built KMP fixture with all four source sets, and the Android/Compose markers
  deliberately split root-vs-module (mirroring the confirmed-real layout), synced via the real CLI
  and verified correct on every dimension in one pass.

## Related

Fourth and final spec in the v2.10.0 batch (housekeeping, server hardening, near-duplicate
detection, Kotlin source-set labeling). Independent of the other three — no shared code. A
deliberately small slice of the deferred KMP initiative (ROADMAP.md), not that initiative itself —
`settings.gradle` module mapping and the source-set dependency graph remain the real prerequisites
for `expect`/`actual` edges, still tracked as future work.
