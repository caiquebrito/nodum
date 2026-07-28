---
"@caiquebrito/nodum-mcp": minor
---

Adds unit test coverage for the three headline v2.0 efficiency features that had none until this release: `semantic-search.ts`, `conversation-cache.ts`, and the previously-untested parts of `smart-context.ts` (`buildNodeContext` went from zero coverage anywhere in the codebase to full coverage of its truncation and not-found paths). `@caiquebrito/nodum-mcp`'s suite goes from 24 to 58 tests.

`extractKeywords`, `scoreNode`, and `findRelevantNodes` are now exported from `smart-context.ts` (previously module-private) so they can be tested directly rather than only indirectly through `buildSmartContext()`'s output — a behavior-preserving change, but a new addition to the package's public surface (spec 029, closing out the v2.2.0 measurement release).
