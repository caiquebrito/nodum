# 051 — Kotlin module labeling via path derivation

## Status: done

Implemented and tested (11 new `detectModule`/`applyModules` cases in `source-set.test.ts`, +3 in
`graph-gen.test.ts`, +2 in `smart-context.test.ts`; `readSettingsGradle`'s test cases removed along
with the dead function). Full workspace suite green. Real check: re-synced `vv-viaunica-android` (a
real 6,432-file, 56,598-node multi-module Android project) into the real `~/.nodum` data directory
— 44 distinct modules detected, matching all 42 modules the project's own `settings.gradle.kts`
declares plus 2 real non-Gradle directories following the same layout convention; this re-sync also
fixed a stale real-data discrepancy left over from spec 049 (that spec's own verification had only
targeted a temp data dir). A first implementation attempt (generic `/src/` split) was caught by this
same real verification wrongly tagging 593 nodes in this repo's own TypeScript graph — fixed by
gating the module boundary on the same Kotlin/Java convention `sourceSet` requires, then reverified
at 0 false positives. Re-sync diff (`nodum diff`) showed zero drift. Second spec in the v2.11.0
batch.

## Goal

Label Gradle modules (`forro/feature`, `app`, ...) on `Node`, purely by path derivation — no
`settings.gradle` parsing — the small, standalone-value slice of the deferred KMP initiative that
spec 049 (Kotlin source-set labeling) explicitly deferred.

## Why now

ROADMAP.md named `settings.gradle`'s `include(...)` parsing as KMP's remaining prerequisite.
Research for this batch measured against a real 55,210-node project (`vv-viaunica-android`) that
100% of node file paths already encode their Gradle module — the directory segment immediately
before `/src/` — with zero `settings.gradle` parsing needed. Regex-parsing `settings.gradle` was
separately found *less* reliable on real projects: `includeBuild(...)`/`includeGroupByRegex(...)`
both false-match a naive `include(` regex, and some real projects build their module list
programmatically (unparseable by any regex). Path-derivation sidesteps all of this and mirrors
spec 049's `sourceSet` design exactly. Second spec in the v2.11.0 batch.

## Scope

- New `MODULE_PATTERN`/`detectModule(filePath)`/`applyModules(nodes)` in
  `analyzer/source-set.ts`, sibling to `SOURCE_SET_PATTERN`/`detectSourceSet`/`applySourceSets`.
- New `Node.module?: string` field (`types.ts`), additive.
- Wired into `graph-gen.ts` alongside the existing `applySourceSets(nodes)` call, in both the full
  and incremental sync paths.
- `mcp/src/smart-context.ts`'s `buildNodeContext` gains a conditional `Module: <name>` line, same
  "only rendered when present" posture as the existing `Source set:` line from spec 049.
- Deleted the confirmed-dead `readSettingsGradle` (unused beyond its own test) from
  `config-reader.ts` and its test — small, directly-adjacent cleanup found while touching this area.
- **Deliberately not attempted**: any `settings.gradle` parsing at all.

## Out of scope

- `settings.gradle`'s `include(...)` parsing and the source-set *dependency* graph — both remain
  deferred to the real future KMP initiative, unchanged from spec 049's framing.
- `expect`/`actual` edges.
- A dedicated CLI/analyzer view of module structure — the MCP `get_node` line is this spec's only
  new user-facing surface, same posture as spec 049.

## Design

### The module boundary is gated on the same Kotlin/Java convention as `sourceSet`, not a bare `/src/` split

A first implementation used a generic `/^(.+?)\/src\//` split — module is "everything before the
first `/src/` path segment." Real end-to-end verification against this very repo (a TypeScript
monorepo whose own package layout is `packages/<name>/src/...`) caught this immediately: 593
TypeScript nodes in the `nodum` project's own graph got wrongly tagged with a module, since the
generic split doesn't care what comes after `/src/`. This directly violated this spec's own
"a TypeScript-only project gets zero `module`-tagged nodes" acceptance criterion, found only by
actually re-syncing a real non-Kotlin project, not by reasoning about the regex in the abstract.

Fixed by gating `MODULE_PATTERN` on the exact same Kotlin/Java source-set convention
`SOURCE_SET_PATTERN` requires: `/^(.+?)\/src\/[^/]+\/(?:kotlin|java)\//` — module is only derived
from the prefix of a path that *also* matches a real `src/<name>/kotlin|java/` source-set
directory, never from a bare `/src/` occurrence. This ties `module` and `sourceSet` to the same
underlying convention by construction — a project only gets one if it also gets the other — and
fully eliminates the false-positive class this verification found.

### Why module labeling can't go stale, by construction

Same argument as spec 049's `sourceSet`: `applyModules` is a pure function of `node.file`, itself
baked into the node's own id — a file that moves to a different module gets a brand-new node id on
its next parse, not a mutated old one.

## Acceptance criteria

- [x] `Node.module` is correctly stamped for a real multi-module Android project's Kotlin/Java
      files, both top-level (`app`) and nested (`forro/feature`) module paths.
- [x] Module stamping happens in both the full-sync and incremental-sync code paths.
- [x] A TypeScript-only project (including this repo's own `packages/<name>/src/...` layout) gets
      zero `module`-tagged nodes — verified as a real regression, not just a unit test, after an
      initial implementation attempt was caught failing this exact criterion.
- [x] `mcp get_node` shows a `Module:` line only for a node that has one; output for every other
      node type is byte-identical to before this spec.
- [x] Re-syncing the same project twice produces zero drift (`nodum diff`).
- [x] `readSettingsGradle` (confirmed dead code) removed.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`source-set.test.ts` (+11 cases): `detectModule` for top-level/nested modules, a single-module
project (no prefix before `src/`), a path with no `src/` segment at all, Windows-separator
normalization, stopping at the first `/src/` occurrence rather than a later one, and the real
regression this spec's own verification caught (a non-Gradle TypeScript monorepo's own
`packages/<name>/src/` layout must not match); `applyModules` stamping/idempotence/stale-clearing,
mirroring `applySourceSets`'s existing test shape. `graph-gen.test.ts` (+3 cases): stamping in both
full and incremental sync paths, non-matching paths untouched. `smart-context.test.ts` (+2 cases):
the conditional `Module:` line shown/omitted correctly. `config-reader.test.ts`: `readSettingsGradle`
cases removed along with the function.

**Real end-to-end (mandatory):** re-synced `vv-viaunica-android` (a real, already-synced multi-
module Android project) using the **real** `~/.nodum` data directory (not a `/tmp` scratch dir —
spec 049's own verification had left this project's real `~/.nodum/vv-viaunica-android` entry
stale, still showing empty `languages`/`frameworks`, because that spec's verification only targeted
a temporary data dir; this re-sync fixed that as a real side effect). Result: 56,598 nodes, 44
distinct modules detected, matching **all 42** modules the project's own `settings.gradle.kts`
declares, plus 2 real non-Gradle directories (`buildSrc`, `tests-e2e`) that also follow the same
source-set layout convention. Regression check: re-synced this repo itself (`packages/<name>/src/`
TypeScript layout) and found the initial generic-`/src/`-split implementation wrongly tagged 593
nodes with a module — caught by this exact real check, not assumed correct — fixed by gating on the
Kotlin/Java convention, then re-verified as 0 tagged nodes. Re-synced `vv-viaunica-android` again
after the fix (same 44-module result) and diffed against the pre-re-sync snapshot via `nodum diff`
— zero drift (0 added/removed/changed nodes and edges).

## Success Metrics

- Real check: `vv-viaunica-android`'s real `~/.nodum/projects.json` entry, stale since spec 049
  (still showing `languages: []`/`frameworks: []` due to that spec's verification targeting a temp
  data dir), now correctly shows `languages: ['Kotlin/Java']`, `frameworks: ['Android', 'Jetpack
  Compose']` after this spec's real re-sync — a genuine fix to real local data, not just a
  hypothetical.
- Real check: 100% of `vv-viaunica-android`'s 56,598 nodes matched the module convention (0
  untagged), yielding all 42 of the project's declared Gradle modules by path alone.
- Real check: this spec's first implementation attempt (a generic `/src/` split) was caught
  producing false positives on a real TypeScript monorepo (this very repo) during mandatory
  end-to-end verification, not by code review alone — the fix (gating on the Kotlin/Java
  convention) was verified to bring the false-positive count to exactly 0.
- Real check: re-sync of the same real project twice produces zero `nodum diff` drift.

## Related

Second spec in the v2.11.0 batch (MCP protocol fix, Kotlin module labeling, all-pairs
near-duplicate grouping). A deliberately small slice of the deferred KMP initiative (ROADMAP.md),
mirroring [049](../049-kotlin-source-sets/spec.md)'s `sourceSet` design exactly —
`settings.gradle` module mapping and the source-set dependency graph remain the real prerequisites
for `expect`/`actual` edges, still tracked as future work.
