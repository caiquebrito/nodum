# 048 — Near-duplicate code detection (single-node fuzzy lookup)

## Status: done

Implemented and tested (35 new cases across `similarity-signature.test.ts`, `duplicate-hash.test.ts`,
`similar-code.test.ts`, and CLI/MCP wiring tests; full workspace suite green — 481 core, 97 cli, 15
server, 78 mcp, 8 benchmarks, 679 total, up from 655 before this spec). Real check: a hand-built
discrimination fixture (exact/fuzzy/heavily-modified/unrelated cases), the same near-duplicate pair
hand-written in all 8 languages (similarity estimates ranging 0.688–1.0 depending on grammar,
every language caught at the calibrated threshold), and a real threshold sweep against ~370 node
pairs across nodum's own codebase — zero false positives observed down to a 0.5 threshold. A real
before/after sync of a 6432-file, 70 MB-graph Android project measured a 3.6% size increase and a
5.8% wall-clock slowdown, both well inside this spec's acceptance bounds. Third of four specs in
the v2.10.0 batch.

## Goal

Make `find_similar_code`/`nodum similar-code` genuinely fuzzy — able to surface *near*-duplicates
(the same logic with a branch added, a rename, a minor refactor), not just byte-for-byte structural
clones. Scoped to single-node lookup only; see Out of scope for what's deliberately not attempted.

## Why now

`findSimilarCode` existed since spec 015 but was never actually fuzzy — it just looked up which
`detectDuplicates` exact-hash bucket a node belonged to. The MCP tool's own description already
claimed "structurally near-identical... robust to renaming," which was only true for exact
Type-2 clones. ROADMAP.md had carried "cross-language duplication detection" since v2.1.0 without
ever building same-language fuzzy matching, its real prerequisite — this spec builds that
prerequisite, scoped down from the full cross-language ambition (see Out of scope).

## Scope

- New `packages/core/src/parser/similarity-signature.ts`: a MinHash-style similarity signature
  over 5-gram shingles of the same normalized token stream every parser's `collectNormalizedTokens`
  already produces for `duplicateHash` — no parser's token-collection logic was touched. 32 lanes,
  each truncated to its top 16 bits and hex-encoded, producing a fixed-width 128-character string
  (chosen over a raw `number[]` specifically to bound `graph.json`'s on-disk cost — pretty-printed
  JSON puts every array element on its own line, making an array cost roughly 3x what one
  concatenated string costs for the same information). A stricter token-count floor
  (`MIN_TOKENS_FOR_SIMILARITY = 40`) than `duplicateHash`'s existing 20 — a node can have one, both,
  or neither field.
- Hand-rolled FNV-1a for the per-shingle base hash, not `crypto.createHash` — **measured, not
  assumed**: 5 million synthetic per-shingle hashes took 396ms with FNV-1a vs. 1.75s with
  `crypto.createHash` (~4.4x slower), a real cost at the scale of a large project's full sync.
- `duplicate-hash.ts` gains `buildDuplicateSignals(tokens)`, returning both the existing
  `duplicateHash` and the new `similaritySignature` from one token stream — `hashTokens` itself is
  byte-identical, untouched. Wired into all 8 parsers' node-creation call sites (mechanical, the
  same shape as spec 045's `computeCognitiveComplexity` wiring) — no parser's
  `collectNormalizedTokens` implementation was touched.
- New `Node.similaritySignature?: string` field (`types.ts`), additive alongside `duplicateHash`.
- `analyzer/similar-code.ts` rewritten: `findSimilarCode(graph, nodeId, options?)` returns the
  **union of exact and fuzzy matches, exact taking precedence** — every node sharing an exact
  `duplicateHash` (`kind: 'exact'`, `similarity: 1`, identical to pre-spec-048 behavior) plus every
  other node whose signature estimates `>= threshold` similarity (`kind: 'fuzzy'`).
  `analyzer/duplication.ts`'s `detectDuplicates` (used directly by `suggest-refactoring.ts` and the
  CLI `duplicates` command) is untouched.
- CLI's `nodum similar-code` gains `--threshold`/`--limit` flags and prints each match's similarity
  percentage and kind. MCP's `find_similar_code` tool description now accurately describes both
  mechanisms and gains an optional `threshold` parameter. `cli/export-formats.ts` strips
  `similaritySignature` (alongside the existing `embedding` strip) from exported graphs —
  meaningless outside nodum's own lookup path.

## Out of scope

- **All-pairs near-duplicate grouping** (a "Spec B"). Single-node lookup is O(n) per query and
  needed no new infrastructure; all-pairs grouping is O(n²) without LSH banding, breaks
  `DuplicateGroup.hash: string`'s shape (a fuzzy group has no single hash), and needs its own
  false-positive calibration story at a different scale — deferred as its own future spec.
- Any change to `duplication.ts`'s exact-hash grouping or its consumers (`suggest-refactoring.ts`,
  the `duplicates` CLI command) — both keep using exact matching only, unchanged.
- Distinguishing `&&` vs. `||` in the similarity estimate, or any operator-change-aware weighting —
  the estimator treats boolean-chain structure generically.
- Cross-language similarity — this spec's signatures are built from each language's own
  grammar-specific token vocabulary (tree-sitter node-type names differ per grammar), so two
  structurally-identical functions in different languages do not produce comparable signatures.
  Real cross-language matching would need a canonicalized, language-agnostic token vocabulary —
  a substantially larger undertaking, not attempted here.

## Design

### The union-with-exact-precedence shape is load-bearing, not a nicety

`similaritySignature`'s token floor (40) is strictly higher than `duplicateHash`'s (20), so a
20–39-token function has an exact hash but no fuzzy signature. A fuzzy-only rewrite of
`findSimilarCode` would have silently *lost* matches the function already found before this spec —
a real regression, not a hypothetical one. The union prevents it by construction; a dedicated test
(`"union with exact precedence: exact matches survive even when the origin node has no
similaritySignature"`) locks this in as the anti-regression case.

### Why the signature algorithm has no per-language special-casing

Unlike `computeCognitiveComplexity` (spec 045), which needed language-specific handling for
boolean-operator-chain collapsing, `buildSimilaritySignature` treats the normalized token stream
generically — plain 5-gram shingling over whatever tokens `collectNormalizedTokens` already
produced, with no boolean-operator-aware logic at all. This is a deliberate simplicity choice: a
generic shingle-based estimator needs no per-grammar tuning to be correct, only to be *well
calibrated* (see below) — the per-language variance observed during calibration comes entirely from
each grammar's own token-vocabulary shape (how many distinct node types it uses, how verbose its
AST is), not from any bug in the shared algorithm.

### Threshold calibration, justified by real data, not asserted

Two real checks drove the shipped `DEFAULT_SIMILARITY_THRESHOLD = 0.65`:

1. **A real-corpus sweep.** Every scored node pair (excluding exact-hash matches) across nodum's
   own codebase (`packages/core` synced standalone, plus the full monorepo — 328 total scored
   nodes) was compared at thresholds from 0.5 to 0.9. **Zero false positives were observed even
   down to 0.5** — every matched pair at every threshold, hand-inspected, was a real structural
   similarity: the 8 language parsers' near-identical `parse()`/`visit()` method shapes (0.656–0.813
   similarity, the same pipeline shape independently implemented per language), duplicated
   test-mock helper functions (`mockFiles`, `funcNode` — genuinely copy-pasted across test files),
   and sibling analyzer functions (`saveArchitectureConfig`/`saveScanConfig`,
   `findExternalDeps`/`findIncomingDeps` — both real pairs of near-identical logic).
2. **A polyglot near-duplicate fixture** — the same function (a loop with a running total, two
   `if` branches, a tax calculation) plus a near-duplicate variant (one additional `if` branch),
   hand-written in all 8 languages. Estimated similarity ranged from **0.688 (TypeScript) to 1.0
   (Objective-C)** depending on the language's own grammar/token-vocabulary shape — a real, expected
   per-language variance, not noise to explain away. A threshold of 0.7 (the first value
   considered) would have missed this exact near-duplicate case in the lowest-scoring language.

`0.65` sits below that polyglot recall floor while staying meaningfully above the 0.5 point where
the corpus sweep still showed zero false positives — a safety margin, not the observed noise floor
itself. Lowering it further later, if warranted by broader usage, is a non-breaking change; shipping
an over-eager default that needs walking back would not have been.

## Acceptance criteria

- [x] `findSimilarCode` returns exact matches identical to pre-spec-048 behavior (verified: every
      pre-existing exact-match test passes with its original assertions, only the returned object's
      shape gained fields).
- [x] A near-duplicate (same logic, one branch added) is found at the default threshold in all 8
      languages, including the lowest-scoring case (TypeScript, 0.688 raw estimate).
- [x] A short function (20–39 tokens) with no `similaritySignature` still gets its exact matches via
      the `duplicateHash` path — the union's anti-regression guarantee.
- [x] Two unrelated functions, and two functions below the similarity floor, are never fuzzy-matched.
- [x] `graph.json` size growth on a large real project (6432 files) is 3.6%, and full-sync wall-clock
      slowdown is 5.8% — both comfortably inside this spec's acceptance bounds (< 15%, < 10%).
- [x] `nodum diff` on the same project before/after shows identical stats and zero added/removed
      nodes or edges — a purely additive change.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`similarity-signature.test.ts` (9 cases): floor respected, fixed-width hex output, determinism,
estimator returns 1 for identical/near-0 for unrelated/high for a one-token perturbation out of
many, symmetry, never throws on malformed input. `duplicate-hash.test.ts` (+4 cases):
`buildDuplicateSignals` sets neither/one/both fields across the two floors, `duplicateHash` output
unchanged. `similar-code.test.ts` (+9 cases): fuzzy match via signature alone, no match for
unrelated signatures, threshold respected in both directions, empty result for a node with neither
signal, the anti-regression exact-survives-without-signature case, exact-precedence dedup, sort
order, limit, reported effective threshold. CLI and MCP wiring tests updated for the new response
shape (`threshold`, `similarity`, `kind` fields) plus new cases for `--threshold`/`--limit` and the
MCP `threshold` parameter reaching the real handler dispatch path.

## Success Metrics

- Real check: hand-built discrimination fixture — byte-identical bodies matched as `exact`
  (`similarity: 1`); a near-duplicate (one added branch) matched as `fuzzy` at a real 0.6875
  estimate; a heavily-modified function (different loop style, different variable names, extra
  statements) scored 0 similarity against the original — correctly *not* matched even at a lowered
  0.3 threshold; two unrelated one-line functions stayed below both floors entirely.
- Real check: the same near-duplicate pair in all 8 languages, synced via the real CLI and queried
  via `nodum similar-code` — every language's near-duplicate was found as a fuzzy match at the
  shipped default threshold (0.65), with per-language raw estimates of Java 84%, Go 78%, JS 84%,
  Kotlin 84%, Objective-C 100%, Python 72%, Swift 88%, TypeScript 69%.
- Real check: threshold calibration sweep — 328 scored nodes across nodum's own codebase, ~370
  non-exact pairs compared at thresholds 0.5–0.9, zero false positives observed at any threshold
  down to 0.5 (full sample recorded in Design).
- Real check: `vv-viaunica-android` (a real 6432-file Android project, 70.5 MB pre-spec-048
  `graph.json`) synced before and after this spec's changes. `graph.json` grew from 70,516,781 to
  73,065,411 bytes (**+3.6%**); full sync wall-clock went from 131.52s to 139.11s (**+5.8%**);
  `nodum diff` between the two graphs showed identical stats (files/functions/classes/interfaces/
  edges/enums all unchanged) and zero added/removed nodes or edges.

## Related

Third of four specs in the v2.10.0 batch (housekeeping, server hardening, near-duplicate detection,
Kotlin source-set labeling). Independent of the other three — no shared code. Builds the same-
language near-duplicate detection prerequisite ROADMAP.md's "Next" section names as blocking the
long-carried cross-language duplication goal; that goal itself remains out of scope (see Out of
scope) pending a canonicalized, language-agnostic token vocabulary this spec deliberately doesn't
attempt.
