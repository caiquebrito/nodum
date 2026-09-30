# 079 — Cross-language near-duplicate detection: build the language-agnostic prerequisite

## Status: done — researched, not viable at a usable threshold; no code shipped

Built and calibrated the candidate signal this spec's own Scope section named: collapse each
parser's raw grammar-node-type token stream down to a small, hand-curated cross-language
control-flow vocabulary (`IF`/`FOR`/`WHILE`/`CATCH`/`CALL`/`RETURN`/`ASSIGN`/`LOGIC`/`TERNARY`/
`CASE`, plus the existing `ID`/`LIT`), then MinHash/Jaccard-estimate similarity over 5-gram
shingles of the collapsed stream — architecturally identical to `similarity-signature.ts`'s
existing same-language approach, just over a coarser, language-agnostic alphabet.

**Grammar shapes verified empirically first** (this codebase's own standing practice, not assumed
from generic docs): parsed real snippets through all 6 non-TypeScript grammars this repo already
vendors (`web-tree-sitter` + `tree-sitter-wasms`) and inspected the real resulting node types
before writing the vocabulary map — e.g. Go's `if_statement`/`for_statement`/`call_expression`/
`return_statement`/`short_var_declaration`, Kotlin's `if_expression`/`jump_expression`/
`property_declaration`, Python's `call`/`assignment`, Swift's `control_transfer_statement`, none
assumed from another language's shape even where names looked similar.

**Calibration, real hand-ported functions, not synthetic pairs**: 4 functions (`fetchUser`,
`calculateDiscount`, `validateAndSaveOrder`, `computeFibonacci` — a guard-clause-plus-loop shape,
an accumulator-loop shape, a multi-guard-clause-plus-loop shape, and a pure iterative-accumulator
shape respectively, deliberately varied so the calibration wasn't testing one structural pattern
against itself), each hand-ported line-for-line across 6 languages (Go, Kotlin, Python, Java,
JavaScript, Swift) — 24 real snippets, 60 same-function cross-language pairs, 216 different-
function cross-language pairs, all real computed Jaccard similarities over the real collapsed
token streams (not simulated).

**Real result: the two distributions overlap enough that no single threshold is defensible.**

| | n | min | avg | max |
|---|---|---|---|---|
| Same-function, cross-language pairs (should score high) | 60 | 0.182 | 0.473 | 1.000 |
| Different-function, cross-language pairs (should score low) | 216 | 0.000 | 0.078 | 0.357 |

The averages separate cleanly (0.473 vs. 0.078, a real ~6x gap) — but the tails overlap: the lowest
real same-function score (0.182, Go↔Java `validateAndSaveOrder` — Java's getter-chain idiom
(`order.getCustomerId().isEmpty()`) emits extra `CALL` tokens Go's direct field access
(`order.CustomerID == ""`) never does, a real, unavoidable per-language idiom difference, not a
vocabulary bug) sits well below the highest real different-function score (0.357, `fetchUser`
(Go/Kotlin)↔`calculateDiscount`(JavaScript) — both are simple guard-clause-plus-loop shapes that
collapse to a similar token skeleton even though their logic differs). A threshold high enough to
exclude that 0.357 false-positive-adjacent case (≥0.36) misses 21/60 (35%) of genuine same-function
pairs; a threshold low enough to catch 90%+ of genuine matches (≤0.25) admits real false positives.
This is the same short-function noise problem `MIN_TOKENS_FOR_SIMILARITY` already documents for
the same-language signal — except here it's structural, not just a token-count floor: collapsing to
a ~12-symbol alphabet (vs. same-language's dozens of distinct per-construct node-type names)
inherently sheds the fine-grained structure that same-language shingling relies on for a clean
separation, and real per-language idiom differences (getter chains, different loop-bound syntax,
different guard-clause phrasing) add noise a same-language signal never has to absorb.

**Verdict, stated honestly per this spec's own Scope section: not viable at a usable threshold, as
currently designed.** No `crossLanguageSimilaritySignature`, no new `find_similar_code` mode, and
no matching-logic change were shipped — the calibration step is the deliverable, not a stepping
stone silently abandoned. A future attempt would need either a richer collapsed vocabulary (losing
less structure) or a fundamentally different representation (e.g. embedding-based rather than
token-shingle-based) — out of this spec's own scope, which was to validate this specific candidate
before building anything permanent around it.

## Goal

Determine whether cross-language near-duplicate detection (e.g. flagging structurally-equivalent
`fetchUser` implementations hand-ported between a Kotlin Android client and a Swift iOS client in
the same KMP-adjacent or shared-logic codebase) is buildable at all with a language-agnostic
similarity signal, and if so, ship a first version — the item `docs/development/ROADMAP.md`'s
"Next" section has flagged as blocked since v2.1.0, through two now-built same-language
prerequisites (specs 048, 052).

## Why now

The other two same-language near-duplicate prerequisites this initiative depended on are done:
spec 048 built the fuzzy MinHash *lookup* (`find_similar_code`), spec 052 built *grouping*. Both
are explicitly named in the roadmap as what this item was blocked on. What's left is the part the
roadmap has always flagged as needing its own mechanism, not an extension: `duplicate-hash.ts`'s
`buildDuplicateSignals` and `similarity-signature.ts`'s MinHash both operate over each parser's own
`collectNormalizedTokens` output — a stream of `ID`/`LIT`/**grammar-node-type-name** tokens (e.g.
`if_statement` in Go, `if_expression` in Kotlin, `IfStatement` in TS's compiler-API-based
extraction). Two structurally-identical functions in different languages produce token streams
built from disjoint vocabularies by construction — no threshold tuning on the existing signature
closes that gap; it needs a genuinely different, language-agnostic representation underneath.

## Scope

**This is a real research spec, not a guaranteed-shippable feature** — say so honestly if the
research step finds the approach doesn't hold up on real code, the same posture spec 067's
roadmap entry used when its own richer-embedding-text change introduced a real, disclosed
regression rather than reporting only the win.

1. **Define one candidate language-agnostic normalization** and validate it before building
   anything permanent. The most promising candidate given what already exists here: collapse each
   parser's existing per-node-type token (`if_statement`/`if_expression`/`IfStatement`) down to a
   small, hand-curated **cross-language control-flow vocabulary** (`IF`, `FOR`, `WHILE`, `CALL`,
   `RETURN`, `ID`, `LIT`, …) — each of the 8 parsers already computes `COMPLEXITY_NODE_TYPES`-style
   sets mapping their own grammar's node types onto a common structural meaning (see e.g.
   `kotlin.ts`'s `COMPLEXITY_NODE_TYPES`, `go.ts`'s `GO_COGNITIVE_CONFIG`) — this is the same
   mapping work already done once per language for complexity scoring, reused for a different
   purpose rather than invented fresh.
2. **Calibrate against real code, not synthetic pairs** — same discipline spec 048's own threshold
   (0.65) was calibrated with (a ~370-pair sweep across nodum's own codebase, an 8-language
   polyglot fixture). For cross-language specifically: hand-port a handful of real functions
   between 2-3 language pairs already present in this codebase's own real fixtures/benchmarks
   (e.g. `benchmarks/projects/`), run the candidate signature over both sides, and measure whether
   real matches score meaningfully higher than real non-matches — if the signal is too noisy to
   set a usable threshold, that is the finding, and this spec's job becomes documenting why and
   closing the roadmap item as "researched, not viable yet" rather than forcing a shipped feature
   with a threshold nobody can justify.
3. **If the signal holds up**: a new `crossLanguageSimilaritySignature` alongside (not replacing)
   the existing per-language `duplicateHash`/`similaritySignature`, computed from the collapsed
   control-flow vocabulary stream, with its own threshold and its own `find_similar_code` mode/flag
   (existing exact/fuzzy modes stay untouched) — architecture mirroring `similarity-signature.ts`'s
   own MinHash approach since it's already proven at the same-language scale.

## Out of scope

- Any change to the existing same-language `duplicateHash`/`similaritySignature` — additive only,
  this is a new signal alongside them, not a replacement.
- Cross-language duplication for language pairs with no shared control-flow vocabulary overlap in
  this codebase's own parsers yet (e.g. if the calibration step only covers Kotlin/Swift, don't
  claim JS/Python coverage without separately validating it).
- A UI/viewer surface for cross-language results — `find_similar_code`/`nodum similar-code`'s
  existing text output is the delivery surface; no new viewer work implied by this spec.

## Design

Deliberately left for the research step (1-2 above) to determine, not prescribed here — this
spec's own Scope section is explicit that the shipped design depends on whether the candidate
signal survives real-code calibration, the same "don't design past an unanswered research
question" posture spec 077 uses for the package-scoping question.

## Acceptance criteria

- [x] A calibration report exists (in this completed spec's own `## Status` writeup, not a
      separate doc) showing real hand-ported same-logic pairs across 6 languages (5 language
      pairs' worth more than the "at least 2" minimum), with real similarity scores, and a stated
      verdict: **not viable at a usable threshold, as currently designed.**
- [x] No cross-language mode was shipped, per the stated verdict — `find_similar_code`/
      `nodum similar-code` are unchanged.
- [x] `docs/development/ROADMAP.md`'s "Cross-language duplication detection" entry is updated to
      reflect the real outcome.

## Test plan

No new production tests — no code shipped, per the stated verdict. The calibration step (24 real
hand-ported snippets across 4 functions × 6 languages, 276 real computed pairwise Jaccard
similarities) IS the primary verification, documented above — real hand-ported function pairs,
real computed scores, inspected directly, not simulated.

## Success Metrics

Real precision/recall-style numbers from the calibration step, the same style spec 048's own
threshold calibration produced: same-function cross-language pairs scored 0.182–1.000 (avg 0.473,
n=60); different-function cross-language pairs scored 0.000–0.357 (avg 0.078, n=216). The overlap
between the two ranges (0.182–0.357) is what makes this "not viable," not a synthetic accuracy
claim — any threshold in that band trades real recall for real false-positive risk with no
principled way to pick a value, the exact "threshold nobody can justify" this spec's own Scope
section said not to ship.

## Related

- `docs/development/completed/048-near-duplicate-detection/spec.md` — the same-language MinHash
  lookup this spec's candidate design reuses architecturally.
- `docs/development/completed/052-near-duplicate-grouping/spec.md` — the other same-language
  prerequisite this initiative was blocked on, now built.
- `docs/development/ROADMAP.md`'s "Cross-language duplication detection" entry under "Next" — the
  source of this spec's scope, unchanged in substance since v2.1.0.
