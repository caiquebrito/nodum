---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": patch
"@caiquebrito/nodum-mcp": patch
---

Fixes dead-code/duplication/cycle/bottleneck false positives found in a real-world Kotlin/Android accuracy audit (~13-40% precision on that codebase before this fix):

- **dead-code**: Kotlin same-package/no-import symbol resolution (new `referencedIdentifiers`/`declaredTopLevelNames` fields on file nodes) and AndroidManifest.xml entry-point awareness (new `android-manifest.ts`, exported as `findManifestEntryFiles`/`parseManifestEntryPoints`), wired into the CLI `dead-code` command and MCP's `suggest_refactoring` (new `SuggestRefactoringOptions.deadCodeEntryPatterns`).
- **cycles**: a specifier resolving back to its own file no longer emits a self-import edge, fixing a Kotlin companion-object import (`import Foo.Companion.x` inside `Foo.kt` itself) being reported as a circular import.
- **duplication**: suggestions from `suggestRefactoring` now name the actual duplicated symbol instead of a generic count; `detectDuplicates` suppresses a group when its members already delegate to a shared helper call (that's reuse, not duplication).
- **bottlenecks**: `Bottleneck` gains a `risk: 'high' | 'foundational' | 'complex' | 'low'` classification so a low-complexity, high-fan-in shared type (e.g. a `Result` monad) isn't reported the same as a genuine complex chokepoint; surfaced in both the CLI and MCP output.
