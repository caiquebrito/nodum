# 080 — Dart/Flutter support: build-file reader + parser

## Status: refined — not started

## Goal

Add Dart/Flutter as a supported language — real cross-file `imports` resolution (the
`package:`/`dart:`/relative 3-way scheme `docs/development/ROADMAP.md`'s "Next" section names),
real node/edge extraction (functions, classes, methods — the same baseline every other language
here has), on top of this codebase's first build-file reader (`pubspec.yaml` resolution, needed to
map a `package:my_app/foo.dart` import back to a real file).

## Why now

The other two "Next" items with real prerequisites (cross-language duplication, Kotlin
package-scoping) are either research-first (079) or need the same "confirm before build" step
(077). This one has a real, concrete, findable prerequisite instead: a build-file reader. A repo
scan done as part of scoping this spec confirms two things worth recording here rather than
re-deriving later:

- **The tree-sitter grammar dependency already used for every other language
  (`tree-sitter-wasms`) already vendors `tree-sitter-dart.wasm`** — this was assumed to need
  sourcing/vetting from scratch; it doesn't. That materially changes this spec's actual hardest
  problem from "find and evaluate a grammar" (the multi-spec effort Kotlin's own migration took,
  per `docs/development/completed/044-*`) to "empirically verify this specific grammar's real node
  shapes and structural fidelity" (a known, bounded task this codebase has a template for — see
  Design below) plus the genuinely new build-file-reader work.
- **No YAML dependency exists anywhere in this monorepo** (`grep`-confirmed across every
  `package.json`) — `pubspec.yaml` resolution is a real first, not an incremental extension of an
  existing capability, matching the roadmap's own framing.

## Scope

1. **Grammar fidelity check, empirical not assumed** (this codebase's own standing practice —
   spec 044's Kotlin migration benchmarked `fwcd/tree-sitter-kotlin` at ~61% structural fidelity
   against the real JetBrains compiler *before* committing to it, and every existing parser's own
   doc comments note fields verified "empirically against the real shipped grammar" rather than
   from generic docs). Parse a handful of real Dart/Flutter source shapes (a `StatelessWidget`
   class, a top-level function, an `extension`, a `mixin` — Dart has both, neither maps cleanly
   onto an existing `NodeType` without a real decision) through `tree-sitter-dart.wasm` directly
   and inspect the real resulting node types before writing any extraction logic — this grammar
   has never been used by this codebase before, so nothing about its shape can be assumed from
   another language's grammar, even a similar-looking one.
2. **`pubspec.yaml` resolution** — this codebase's first build-file reader. Needs:
   - A YAML parser dependency (new to this monorepo — pick and justify one, e.g. `yaml` vs.
     `js-yaml`, the same "pick and justify, don't default" posture spec 048 used for its own
     hand-rolled-FNV-vs-crypto decision).
   - Reading a project's `pubspec.yaml` for its own package `name:` field, the minimum needed to
     resolve a same-package `package:my_app/foo.dart` import back to `lib/foo.dart` relative to
     the `pubspec.yaml`'s own directory (Dart/Flutter's real convention: `package:<name>/...` maps
     to that package's `lib/` directory).
   - A decision on `Parser.resolveImport()`'s currently project-config-blind interface (see
     `packages/core/src/parser/base.ts`) — every existing `resolveImport` takes only
     `(specifier, importingFilePath, knownFileIds, knownFilesByPath)`, none of which carries
     parsed `pubspec.yaml` data. Widening this interface is a cross-cutting change every other
     parser's `resolveImport` signature is affected by (even if only by an unused parameter),
     which is exactly why the roadmap flags this as its own real decision, not a Dart-only detail.
3. **Parser implementation** (`packages/core/src/parser/dart.ts`), matching the shape every
   tree-sitter-backed parser here already follows (`TreeSitterParser` base class, a query file for
   function/class/method extraction, `ignoredDirs` for Dart/Flutter's own conventional build
   output directories — `.dart_tool`, `build`), scoped to whatever step 1's fidelity check finds
   real and reliable — if methods/mixins/extensions turn out unreliable in the real grammar,
   ship functions+classes first and document the rest as a follow-up, the same "ship the reliable
   subset, disclose the rest" posture spec 073 used for VS Code vs. JetBrains/Visual Studio.
4. **3-way import resolution** (`package:`, `dart:` — Dart's own SDK-internal scheme, resolves to
   nothing in this codebase's file graph and should be left unresolved rather than guessed at,
   matching how every other parser here handles an external/stdlib import — and relative imports,
   the one part needing no new mechanism at all).

## Out of scope

- Flutter-specific semantic modeling (widget tree structure, `build()` method special-casing,
  state management framework detection) — this spec is language support at the same baseline
  every other language gets (nodes/edges/imports/complexity), not a Flutter-specific feature.
- Cross-language duplication detection between Dart and any other language — spec 079's own
  problem, and blocked on that spec's own research finding regardless of Dart's existence.
- Cognitive/cyclomatic complexity, near-duplicate signatures — add only if step 1's fidelity check
  finds the grammar reliable enough to trust a complexity count from; don't force every feature
  every other language has into this spec's first pass if the real grammar can't support it yet.

## Design

Deliberately left for step 1's empirical grammar check to inform in detail — the query file shape,
which `NodeType`s Dart's `mixin`/`extension` map onto (or whether they need their own, the way
spec 036 added `struct`/`protocol`/`extension` for Swift rather than forcing an ill-fitting
existing type), and the exact scope of step 3's parser work all depend on what the real grammar's
node shapes turn out to be — prescribing them now would be guessing, the same trap 077/079 both
avoid by deferring design to their own research steps.

## Acceptance criteria

- [ ] `pubspec.yaml`'s package `name:` is correctly resolved for a real multi-file Dart project's
      `package:`-style same-package imports (relative imports need no new logic to already work,
      once the parser itself extracts them).
- [ ] `dart:`-scheme imports are left unresolved (zero false-positive edges), matching every other
      parser's external/stdlib-import posture.
- [ ] Functions and classes are extracted as real nodes/edges for a real `.dart` file, verified via
      the real CLI + real `graph.json` inspection (this codebase's standing verification practice
      for every new parser), not unit tests alone.
- [ ] `Parser.resolveImport()`'s interface widening (if needed per step 2) doesn't silently change
      behavior for any existing language's `resolveImport` — every pre-existing import test for
      every other parser stays green unmodified, the same explicit contract spec 036's own Kotlin
      migration held itself to.

## Test plan

- `packages/core/src/parser/dart.test.ts` (new): mirrors the existing per-language test file shape
  (e.g. `kotlin.test.ts`'s own structure) — node/edge extraction, `declaredTopLevelNames`-style
  same-package resolution if applicable, import resolution across all 3 schemes.
- Real check: a small real Dart/Flutter fixture (a `pubspec.yaml` + a `lib/` with 2-3 files
  exercising `package:`/`dart:`/relative imports) synced with the real CLI, real `graph.json`
  inspected directly — same discipline every other language parser's own completed spec used.

## Success Metrics

Not a ranking/retrieval or token-cost change on its own — no `retrieval-eval.ts` before/after
applies to adding a new language. Report real coverage numbers instead (files/functions/classes
extracted, import-resolution rate) against the real fixture project, the same style spec 055's
"18 correct expect/actual pairs" or spec 048's "~370-pair sweep" reported concrete counts rather
than a qualitative claim.

## Related

- `docs/development/completed/044-kotlin-treesitter/spec.md` — the empirical-fidelity-check
  template this spec's Design step 1 follows.
- `docs/development/completed/036-nodetype-vocabulary/spec.md` — the precedent for adding a new
  `NodeType` rather than forcing an ill-fitting one, relevant if Dart's `mixin`/`extension` need
  it.
- `docs/development/ROADMAP.md`'s "Dart/Flutter — still its own future initiative" entry under
  "Next" — the source of this spec's scope.
