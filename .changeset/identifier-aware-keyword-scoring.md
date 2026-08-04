---
"@caiquebrito/nodum-mcp": patch
---

Replace `scoreNode`'s raw substring matching with term-based, IDF-weighted matching over split identifiers (spec 068). New `tokenizeIdentifier` splits camelCase/PascalCase/snake_case/kebab-case labels into terms; a per-graph `TermIndex` (built once per `buildSmartContext` call) scores an exact split-term match higher than a coincidental substring match, and weights each term's contribution by its IDF across the graph's own vocabulary — rare, discriminative terms like `authenticate` now count for more than near-ubiquitous ones like `get`. `extractKeywords`'s length filter also drops from `word.length > 2` to `word.length > 1` (with an explicit short-word stop-list), recovering real identifier fragments like `id`, `db`, `ui`, `io` that used to be silently filtered out.
