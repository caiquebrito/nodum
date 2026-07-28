---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-mcp": minor
---

New `countTokens(text): number` exported from `nodum-core` — an approximate, offline token count (via `js-tiktoken`'s `o200k_base` encoding) for text, since Claude's real tokenizer isn't public. Named `approxTokens` everywhere it surfaces, deliberately not `tokens`, to avoid repeating the precision the codebase previously asserted without measuring (spec 024 kicks off the v2.2.0 measurement release).

`buildSmartContext()` in `nodum-mcp` now returns `{ text, approxTokens }` instead of a bare string — pure instrumentation, MCP response bodies are unchanged. A later spec in this series (026) uses `approxTokens` to replace the hardcoded "40-60% fewer tokens" claims with real numbers.
