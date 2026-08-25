# 079 — Cross-language near-duplicate detection: build the language-agnostic prerequisite

## Status: refined — not started

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

- [ ] A calibration report exists (in the completed spec's own `## Status` writeup, not a separate
      doc) showing real hand-ported same-logic pairs across at least 2 language pairs, with real
      similarity scores, and a stated verdict: viable with a real threshold, or not — either is an
      acceptable outcome, an unstated one is not.
- [ ] If viable: `find_similar_code`/`nodum similar-code` gains a working cross-language mode,
      verified against the same real hand-ported pairs used for calibration (not just unit tests
      of the signature function in isolation).
- [ ] `docs/development/ROADMAP.md`'s "Cross-language duplication detection" entry is updated to
      reflect the real outcome either way.

## Test plan

- `packages/core/src/parser/similarity-signature.test.ts` (or a new sibling file if the
  cross-language signature is architecturally distinct enough to warrant one): unit tests for the
  collapsed-vocabulary mapping itself, mirroring the existing MinHash test shape.
- Real check: the calibration step in Scope #2 above IS the primary verification — real hand-
  ported function pairs, real computed scores, inspected directly, not simulated.

## Success Metrics

If shipped: report real precision/recall-style numbers from the calibration step (true positive
rate on known-matching pairs, false positive rate on known-unrelated pairs across languages) —
the same style of real numbers spec 048's own threshold calibration produced, not a synthetic
accuracy claim.

## Related

- `docs/development/completed/048-near-duplicate-detection/spec.md` — the same-language MinHash
  lookup this spec's candidate design reuses architecturally.
- `docs/development/completed/052-near-duplicate-grouping/spec.md` — the other same-language
  prerequisite this initiative was blocked on, now built.
- `docs/development/ROADMAP.md`'s "Cross-language duplication detection" entry under "Next" — the
  source of this spec's scope, unchanged in substance since v2.1.0.
