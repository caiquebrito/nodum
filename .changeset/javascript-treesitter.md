---
"@caiquebrito/nodum-core": minor
---

Migrates the JavaScript parser from line-regex to tree-sitter. Two previously-undetected bugs fixed: `javascript.ts` never set a `line` number on any node (computed one internally purely to feed the old brace-matching helper, then discarded it — the only one of the four regex parsers with this gap, and untested since nothing anywhere in this codebase asserted line numbers before now), and JS classes got zero member extraction at all.

Class methods (instance, static — all the same node type in this grammar) are now attributed to their class (`classId -> methodId` edge), matching the precedent Python (031) and Java (032) already established. Real cyclomatic complexity, now including a ternary and correctly distinguishing `for...of`/`for...in` from a C-style `for`. Real `duplicateHash`. A concise-body arrow function (`x => x + 1`) deliberately still gets no complexity/hash, same as before this migration — there's no brace-delimited body to walk.

Spec 033, last of the three language migrations in the v2.3.0 tree-sitter batch — TypeScript stays on the compiler API throughout.
