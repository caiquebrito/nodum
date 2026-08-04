# 061 — Fix dead-code/duplication/cycle/bottleneck accuracy

## Status: done

Implemented and tested (25 new/updated tests: 809 total core+cli+mcp+server, up from 798).
Verified against the actually-published `@caiquebrito/nodum-core@2.17.0` package, not just the
local build — see Real check below.

## Goal

A real-world comparison run against a Clean Architecture Android app (Compose, MVI, Koin DI,
Retrofit, multi-module: `app`/`presentation`/`domain`/`data-remote`/`common`/`commonKotlin`/
`design`) found `find_bottlenecks`, `suggest_refactoring`, and `explain_architecture` running at
~13-40% precision on two categories (dead-code ~13%, duplication ~20-40%) and 0% on circular
imports (1 finding, 0 confirmed). Plain cyclomatic-complexity/fan-in counting was 100% accurate —
the problem was interpretation and graph-resolution gaps, not the underlying numbers.

## Why now

The user ran this comparison independently (a separate agent audited the PokemonApp repo, cross-
verified every claim against the real source/`AndroidManifest.xml`/Koin wiring/Compose Navigation
graph) and asked to close the resulting false-positive gaps rather than let the report sit.

## What the audit found — 7 root causes

1. **No same-package/no-import symbol resolution.** Kotlin allows referencing a top-level
   `internal`/public declaration in the same package with zero `import` statement — flagged as
   dead (e.g. `Palette.kt`, an `internal object` used unqualified by `Theme.kt` in the same
   package).
2. **No Android/platform entry-point awareness.** `PokemonApplication.kt`/`StartActivity.kt` are
   wired via `AndroidManifest.xml`, not Kotlin imports — flagged dead.
3. **No DI-framework resolution.** `CommonModule.kt`'s `val commonModule = module { ... }` is
   registered via `loadKoinModules(commonModule)` — a runtime value-passing call, not a type
   reference — flagged dead despite being load-bearing DI wiring.
4. **No generic-type-argument usage resolution.** Type-safe Compose Navigation
   (`composable<RouteType> { }`, `navigate(RouteType(...))`) reads as a generic type argument, not
   a plain import — route/screen files flagged dead.
5. **Duplication findings named the wrong symbol** and didn't check whether "duplicate" functions
   already delegated to a shared helper (which is reuse, not duplication, and should suppress the
   finding).
6. **"Bottleneck" conflated fan-in with actual complexity/risk** — `Result.kt`/`FlowUseCase.kt`
   (12 dependents, complexity ~1-2) scored as top bottlenecks purely from fan-in, despite being
   exactly what a healthy foundational shared type looks like.
7. **Self-referencing companion-object imports registered as circular imports** —
   `import Foo.Companion.x` inside `Foo.kt` itself resolves back to the importing file, read as a
   file-imports-itself cycle.

## Design

Each root cause maps to one fix, in the priority order the audit itself recommended:

- **#2 → `android-manifest.ts`** (new): regex-based (not a full XML parser — same posture as this
  codebase's existing build-file-free import resolution) `AndroidManifest.xml` walk extracting
  `android:name` entry points (`application`/`activity`/`service`/`receiver`/`provider`), resolved
  against the graph via the existing `resolveJvmImport` suffix matching. Wired into the CLI
  `dead-code` command and MCP `suggest_refactoring` (new `SuggestRefactoringOptions.
  deadCodeEntryPatterns`), feeding `detectUnreachableFiles`'s existing `entryPatterns` option.
- **#1 → `Node.referencedIdentifiers`/`Node.declaredTopLevelNames`** (Kotlin parser only): every
  file node now records every bare identifier it references anywhere (unconditional whole-tree
  walk, not scope-resolved against locals/params — same flat-name-lookup posture same-file `calls`
  edges already take) and every top-level symbol it declares, including top-level `val`/`var`
  properties that never get their own graph `Node` at all (needed for #3 — a Koin module is
  typically a bare top-level property). `detectUnreachableFiles` cross-checks same-directory
  siblings before flagging a file dead.
- **#3 and #4 → verified, not separately built.** Because the `referencedIdentifiers` walk doesn't
  stop at any node-type boundary, a generic type argument (`composable<Route>`) and a bare
  identifier passed as a DI-registration argument (`loadKoinModules(commonModule)`) were already
  structurally captured by the #1 mechanism — confirmed end-to-end against the real Kotlin parser
  (`dead-code-kotlin-integration.test.ts`), not assumed. The one genuine gap found during that
  verification was `declaredTopLevelNames`'s property-name extraction (above), since Koin modules
  are conventionally bare top-level properties with no dedicated `Node`.
- **#5 → `duplication.ts`/`suggest-refactoring.ts`**: `suggestRefactoring`'s duplication
  description now names the actual duplicated symbol(s) instead of a generic count.
  `detectDuplicates` suppresses a group when every member already has a `calls` edge to the same
  shared target (intersection of call targets non-empty) — that's the presence of reuse, not
  duplicated logic left to extract.
- **#6 → `bottlenecks.ts`**: new `risk: 'high' | 'foundational' | 'complex' | 'low'` field,
  independent of the existing fan-in-dominated `score` (kept for backward-compat ordering).
  `high` requires both elevated complexity (≥10, matching `suggest-refactoring.ts`'s own default
  threshold) AND at least one dependent; `foundational` is elevated fan-in with low complexity.
  Surfaced in both CLI and MCP output.
- **#7 → `graph-gen.ts`**: `resolveImportsInto` now skips adding an `imports` edge when a
  specifier resolves back to the importing file itself. `detectCycles` itself is untouched — a
  hand-supplied self-loop edge is still a legitimate cycle by construction (existing test
  preserved), the fix is that Kotlin's own companion-object idiom never produces that edge in the
  first place.

## Out of scope

- Java gets the same same-package no-import visibility rule as Kotlin, but only Kotlin's parser
  was extended — Java's own gap is real but wasn't in the audited codebase and is deferred.
- Cross-file **`calls`** resolution generally (a call from file A's function into file B's
  function) remains same-file-only, per spec 034's original scope. The `referencedIdentifiers`
  mechanism here is deliberately narrower and coarser (same-directory only, no scope resolution)
  — it exists to fix dead-code false positives specifically, not to become a general cross-file
  call graph.
- `expect class`/top-level-property `expect`/`actual` gaps (noted in the v2.12.0 "Next" entry)
  are unrelated and untouched.

## Real check

- `npx vitest run` — 809/809 passing across core/cli/mcp/server (up from 798 before this spec).
- `tsc --noEmit` clean on all four packages.
- Fresh `npm install @caiquebrito/nodum-core@2.17.0` (and cli/mcp/server) in a scratch directory,
  independent of the local build: the `nodum` CLI ran and reported the correct version; the new
  exports (`findManifestEntryFiles`, `parseManifestEntryPoints`) loaded correctly; and the actual
  fix code (`classifyRisk`/`foundational`, `usedBySamePackageSibling`, `delegatesToSharedHelper`,
  the `targetId === sourceId` self-import guard) was confirmed present in the published `dist/`,
  not just the source.
- `dead-code-kotlin-integration.test.ts` runs the real Kotlin parser (not a hand-built `Graph`
  fixture) through `detectUnreachableFiles` for the `composable<Route>` generic-argument and
  `loadKoinModules(commonModule)` DI-registration scenarios named in the audit, confirming #3/#4
  needed no new mechanism beyond #1.

## Related

- Report supplied by the user: a real-world accuracy audit against a Kotlin/Android app, independently
  cross-verified against real source/manifest/DI-wiring/navigation-graph before being trusted.
- [`docs/development/ROADMAP.md`](../../ROADMAP.md) — this spec's roadmap entry (v2.17.0).
