---
"@caiquebrito/nodum-core": patch
---

Kotlin `expect`/`actual` detection now tags class-body members (methods), not just top-level declarations — a member's own explicit modifier wins if present, otherwise it inherits the enclosing `expect`/`actual class`'s modifier, matching real Kotlin semantics. Closes the first of three real gaps spec 055 found and documented as follow-ups (the `HttpClientEngineProvider.provideEngine`-shaped case). `applyExpectActual` also gained enclosing-class scoping for method-level matches, needed the moment methods can carry a `platformModifier` at all — without it, two different `expect`/`actual class` pairs in the same module with a same-named member (e.g. two platform-provider classes both exposing `log()`) would cross-link incorrectly.
