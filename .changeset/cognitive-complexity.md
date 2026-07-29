---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

Adds cognitive complexity (SonarSource-inspired) as a second complexity metric alongside the existing cyclomatic (McCabe) one, across all 8 supported languages — nesting-depth-aware, so a deeply-nested `if` costs more than the same count of sequential `if`s, unlike cyclomatic complexity. New `Node.cognitiveComplexity` field, set alongside the existing `complexity` field, never replacing it.

`rankByComplexity` gains an optional `metric: 'cyclomatic' | 'cognitive'` (defaults to `'cyclomatic'`, unchanged behavior); CLI's `nodum complexity` gains a `--cognitive` flag. `find_bottlenecks`/`suggest_refactoring` are unchanged — both keep using cyclomatic complexity by default.

Third and final spec in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).
