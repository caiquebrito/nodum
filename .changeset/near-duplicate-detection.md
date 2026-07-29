---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
"@caiquebrito/nodum-mcp": minor
---

`find_similar_code`/`nodum similar-code` is now genuinely fuzzy — previously it only matched exact structural duplicates (byte-for-byte identical normalized token streams). It now also finds near-duplicates (the same logic with a branch added, a minor refactor) via a new MinHash-style similarity signature computed at parse time across all 8 supported languages, with no new dependency. Exact matches still take precedence and are unaffected.

New `Node.similaritySignature` field (additive, alongside the existing `duplicateHash`). CLI gains `--threshold`/`--limit` flags; MCP's `find_similar_code` gains an optional `threshold` parameter. The default threshold (0.65) was calibrated against real code, not asserted — see spec 048's spec doc for the calibration data.

Third of four specs in the v2.10.0 batch.
