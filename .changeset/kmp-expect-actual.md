---
"@caiquebrito/nodum-core": minor
---

Detects Kotlin `expect`/`actual` declarations and links each `actual` to the `expect` it fulfills via a new `actualizes` edge. Matches within the same Gradle module, by declaration kind and name, validated against Kotlin's default source-set hierarchy (`androidMain`/`iosMain`/`jvmMain` → `commonMain`). No `settings.gradle` parsing needed — confirmed unnecessary since real KMP projects rely on Kotlin's implicit default hierarchy template rather than declaring source-set dependencies explicitly.

Third of three specs in the v2.12.0 batch.
