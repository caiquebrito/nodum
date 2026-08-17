---
"@caiquebrito/nodum-core": patch
---

Kotlin top-level `val`/`var` declarations now get a real `'property'` graph node (previously only their bare name was tracked, for same-package dead-code resolution). This closes the second of three real `expect`/`actual` gaps spec 055 found and documented as follow-ups: a top-level `expect val platformModule: Module` / `actual val platformModule: Module = ...` pair now produces a real `'actualizes'` edge — `applyExpectActual` needed no changes, since it already matches generically by `module + type + label`.
