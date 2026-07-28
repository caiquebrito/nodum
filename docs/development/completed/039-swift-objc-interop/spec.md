# 039 — Shared Swift/Objective-C file-level interop

## Status: done

Implemented and tested (6 new cases in `import-resolver.test.ts`; full workspace suite green —
344 core, 95 cli, 60 mcp, 8 benchmarks, 507 total, up from 501 before this spec). Real check: a
genuinely mixed fixture (a Swift↔Objective-C bridging header, an ObjC class with a header/
implementation pair, and a Swift file importing the ObjC module) synced with the real CLI —
`imports` edges exist across the language boundary in both directions, and the four related files
form **one connected graph component**, not two disconnected islands (computed directly from
`graph.json`, not eyeballed). Re-synced and diffed with `nodum diff` — zero drift. Last of the
four specs in the v2.7.0 "iOS: Swift + Objective-C" batch.

## Goal

Make a mixed Swift/Objective-C repository render as one connected graph rather than two
disconnected islands — the roadmap's own stated failure condition — by unifying spec 037's
`resolveSwiftImport` and spec 038's `resolveObjcImport` into one shared
`resolveSwiftObjcImport()`, entirely inside `import-resolver.ts`.

## Why now

Last in the batch because it needs both parsers (037, 038) to exist to be verifiable — same
reasoning that produced `resolveJvmImport` only once both Java and Kotlin parsers existed. Both
prior specs' resolvers were already structurally near-identical (copy-pasted directory-suffix
matching logic); unifying them is the same DRY step `resolveJvmImport` already represents for
Java/Kotlin.

## Scope

- Collapsed `resolveSwiftImport`/`resolveObjcImport` into one exported
  `resolveSwiftObjcImport(specifier, importingFilePath, knownFileIds, knownFilesByPath)` in
  `packages/core/src/parser/import-resolver.ts`. Both `swift.ts` and `objc.ts` now delegate to it
  in one line each, identical to how `java.ts`/`kotlin.ts` both delegate to `resolveJvmImport`.
- **Quoted-file specifier detection fixed to be extension-aware**, not just "contains a dot":
  a new `QUOTED_FILE_EXTENSION = /\.(h|m|mm)$/i` regex distinguishes a real ObjC quoted include
  (`"Foo.h"`) from a Swift dotted-submodule specifier (`UIKit.UIView`), which also contains a `.`
  but never ends in one of these extensions. (The pre-unification `resolveObjcImport` used a
  simpler "contains a dot" check, which was correct in isolation since it never saw Swift
  specifiers — unifying the two functions required tightening this.)
- **Cross-language candidates, verified working correctly, not just assumed**: the bare-module
  directory-suffix match (Swift `import Foo` / ObjC `@import Foo;`) was **already** extension-
  agnostic in both prior specs' implementations (`knownFilesByPath` was never filtered by file
  extension) — so a Swift `import Legacy` matching `Sources/Legacy/` already returned every file
  there, `.h`/`.m` included, even before this spec's unification. Verified this holds on real code
  in the mixed fixture. What unification adds beyond deduplication: a quoted `#import "Foo.h"`
  with no exact-extension match now also probes the same base name as a `.swift` file — a real,
  new capability (a bridging header resolving to a Swift class that has since replaced its ObjC
  counterpart), not something either spec 037 or 038 could do alone.
- Updated `docs/development/ROADMAP.md`'s v2.7.0 entry to record the interop scope precisely:
  file-level `imports` edges only, not `@objc`-annotation symbol-level `calls` edges (Decision G
  from the batch's plan) — stated plainly rather than left as the original, broader-sounding
  roadmap bullet.

## Out of scope

- **Symbol-level Swift↔ObjC interop** (an `@objc func foo()` in Swift called as `[obj foo]` in
  ObjC, or vice versa). The only cross-file edge mechanism in the entire system is
  `resolveImport()` → `graph-gen.ts`'s `resolveImportsInto()`, hardcoded to emit
  `relation: 'imports'` linking file-to-file only. Building symbol-level cross-language calls
  would require either a new `resolveCall?()` sibling method on `Parser` or widening
  `resolveImportsInto` to accept parser-supplied relation types — both changes to `graph-gen.ts`,
  which fails this release's own litmus test. Deferred to a future spec, same posture as spec 034
  deferring cross-file `calls` within a single language.
- **No new `RelationType`.** All interop here is `'imports'`, matching every other cross-file
  mechanism in the graph.
- `Package.swift`/`.xcodeproj`/`Podfile` parsing — unchanged reduction from spec 037, now applying
  equally to the unified resolver.

## Design

### The quoted-file/module-name disambiguation had to be tightened, not just merged

Before unification, `resolveObjcImport`'s "is this a quoted file?" check was simply
`specifier.includes('.')` — correct for ObjC alone, since an ObjC specifier is either a bare
module name (`MyModule`, no dot) or a quoted filename (`Foo.h`, one dot). But Swift's dotted
submodule form (`import UIKit.UIView`) also contains a dot and is **not** a file reference — it's
still a bare module name, just a compound one. Naively merging the two functions with the ObjC
check would have silently misrouted every Swift submodule import into the quoted-file branch,
which would then fail to match anything and incorrectly return `[]`. Fixed by checking for a real
file extension (`\.(h|m|mm)$`) instead of merely the presence of a dot — this is a real correction
this spec's unification forced, not present as a bug in either spec 037 or 038 alone (each only
ever saw its own language's specifier shapes).

### The connected-component claim was verified computationally, not asserted

Rather than eyeballing `graph.json`'s edge list, the real end-to-end check computed connected
components directly from the synced graph's `imports` edges (a small script, not part of the
shipped code — this is a verification technique, not a feature). Result: the bridging header, the
ObjC class's `.h`/`.m` pair, and the importing Swift file all land in **one** component; a
`Models.swift` file with no imports and nothing importing it correctly lands in its own,
separate, single-file component — expected and correct (it has no real dependency relationships
in the fixture, unrelated to language). This distinction matters: the roadmap's "two disconnected
islands" concern is about files that *do* depend on each other rendering as unconnected, not about
every file in a project needing to be reachable from every other file regardless of real
structure.

## Acceptance criteria

- [x] One shared resolver function; both parsers delegate to it in one line each.
- [x] A Swift module import resolves to every `.h`/`.m`/`.swift` file under a matching directory,
      not filtered by extension.
- [x] A quoted ObjC `#import "Foo.h"` still resolves to a `.swift` file of the same base name when
      no `.h`/`.m` match exists.
- [x] A Swift dotted-submodule import (`import UIKit.UIView`) is not misrouted into the quoted-file
      branch — regression-tested directly, since the unification could have silently broken it.
- [x] A real mixed Swift+ObjC fixture produces `imports` edges across the language boundary in
      both directions, and the related files form one connected component (computed, not
      eyeballed).
- [x] `docs/development/ROADMAP.md` states the interop scope reduction plainly.
- [x] `git diff --stat` for this spec touches no line of `graph-gen.ts`/`file-discovery.ts`.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`import-resolver.test.ts`'s new `resolveSwiftObjcImport` block (6 cases): a Swift module import
resolving to `.h`+`.m` files together (cross-language, unfiltered by extension); a Swift dotted
submodule import resolving the same way (the regression case for the disambiguation fix); a
quoted ObjC `#import` resolving to its exact-extension match; the same falling back to a
same-basename `.swift` file when no `.h`/`.m` match exists (the new bridging-header capability); a
system/SDK module (`Foundation`) resolving to nothing; a quoted include matching neither shape
resolving to nothing.

## Success Metrics

- Real check: `MixedApp-Bridging-Header.h` (`#import "LegacyManager.h"`),
  `Sources/Legacy/LegacyManager.h`/`.m` (an ObjC class), `Sources/App/ViewController.swift`
  (`import Legacy`, references the ObjC class), `Sources/App/Models.swift` (struct/enum/protocol/
  extension, no imports) — synced with the real CLI. Actual `graph.json`: `imports` edges from the
  bridging header to `LegacyManager.h`, from `ViewController.swift` to **both**
  `LegacyManager.h` and `LegacyManager.m` (the Swift `import Legacy` module-name match resolving
  across the language boundary), and from `LegacyManager.m` to its own header. A connected-
  components computation over these edges found exactly 2 components: one containing all four
  ObjC/Swift-interop files together, and one containing only the unrelated `Models.swift` (which
  has no import relationships at all in this fixture — correctly isolated, not a failure). Re-ran
  `sync` and diffed with `nodum diff`: zero drift across all 9 stats keys and zero added/removed/
  changed nodes or edges.

## Related

Depends on: 037 (Swift parser), 038 (Objective-C parser) — both needed to exist for this spec's
unification and verification to be meaningful. Builds on: `resolveJvmImport`'s (spec 030-era)
precedent of one resolver shared across a language pair. Closes out the v2.7.0 "iOS: Swift +
Objective-C" batch (036–039); next is the `develop → main` release PR.
