---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-mcp": minor
---

Fixes a real stack-detection gap: `readBuildGradle`/`readSettingsGradle` only ever read the plain `.gradle` (Groovy) filenames, never `.gradle.kts`/`settings.gradle.kts` (Kotlin DSL) — modern Kotlin/Android projects using the Kotlin DSL went completely undetected (`languages`/`frameworks`/`buildTools` all empty). Also fixes framework detection (`androidx.compose`) in multi-module projects, where plugin markers commonly live in a module's own build file, not the root's.

New `Node.sourceSet` field, path-convention-derived (`commonMain`, `androidMain`, `test`, ...) — surfaced in MCP's `get_node` output when present.

Fourth and final spec in the v2.10.0 batch.
