---
"@caiquebrito/nodum-mcp": patch
---

Fix `buildSmartContext`'s hybrid keyword+semantic ranking, which combined a 0-40 keyword rank with a 0-1 cosine similarity via a weighted sum — keyword score dominated almost completely, making semantic search functionally near-disabled. Replaced with Reciprocal Rank Fusion (RRF), the standard fix for combining rankers on incomparable scales. `mergeScores` and the new `fuseByRRF` primitive live in `semantic-search.ts`; `semanticScoreNodes` also drops its now-mostly-inert `score > 0` filter in favor of a bounded top-K selection.
