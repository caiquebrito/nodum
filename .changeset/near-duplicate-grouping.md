---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
"@caiquebrito/nodum-mcp": minor
---

Adds all-pairs near-duplicate grouping across a whole project: `nodum duplicates --fuzzy` and a new `near-duplication` category in `suggest_refactoring`. Groups are quasi-cliques (every member pairwise-similar to every other member above the threshold), not transitively-chained — real-scale verification found single-linkage transitive closure merges thousands of unrelated functions into one meaningless group on a large real project.

Third of three specs in the v2.11.0 batch.
