---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum complexity [projectPath] [--json] [--threshold N]` — ranks functions/methods by cyclomatic complexity (McCabe), computed at parse time and stored as a new optional `Node.complexity` field. TypeScript is computed precisely from its real AST; JavaScript/Kotlin/Java use a new shared brace-matching body-extraction helper plus regex-based decision-point counting (deliberately excluding ternary for these three languages — a false-positive risk in Kotlin's nullable-type syntax). Python and cognitive complexity are both out of scope for now. `rankByComplexity()` is exported from `nodum-core` for reuse.

Also fixes a real pre-existing bug in the Java parser's method-detection regex, caught while verifying this spec against real code: `} else if (...)` was mis-parsed as a method declaration named `if`.
