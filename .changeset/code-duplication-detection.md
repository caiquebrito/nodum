---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum duplicates [projectPath] [--json]` — finds functions/methods that are structurally near-identical (same control-flow shape, robust to variable renaming and literal-value changes), computed at parse time as a new optional `Node.duplicateHash` field. TypeScript is normalized precisely via its real AST; JavaScript/Kotlin/Java use a new shared regex-based tokenizer built on spec 014's brace-body extraction. A 20-token minimum avoids flooding output with trivial one-liner "duplicates." `detectDuplicates()` is exported from `nodum-core` for reuse. Scoped to Type-2-style exact-structural matching within a single language — Type-3 (near-matches with inserted/deleted statements) and cross-language matching are both out of scope.
