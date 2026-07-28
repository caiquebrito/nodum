---
"@caiquebrito/nodum-core": minor
---

Adds same-file `calls` edges: a function/method that calls another function/method defined in the same file (via a bare identifier, e.g. `foo()`) now gets a `calls` edge to it in the graph. Qualified calls (`this.x()`, `self.x()`, `obj.x()`) are deliberately not resolved — without real type information there's no reliable way to tell whether the receiver refers to something in this file. Implemented for TypeScript, Python, Java, and JavaScript; Kotlin stays on its regex parser and is excluded this release.

This is the prerequisite spec 012 deferred symbol-level dead code on — existing analyzers (`cycles`, `dead-code`, `architecture`, `trace-impact`) are unchanged and continue to operate on `imports` edges only.

Both viewer copies now render `calls` edges with a distinct color/arrowhead from `defines` edges.
