# 045 — Cognitive complexity

## Status: done

Implemented and tested (19 cases across the two new shared-walker test files, plus 4–6
cognitive-specific cases added to each of the 8 existing parser test files — 68 new cases total;
full workspace suite green — 459 core, 96 cli, 77 mcp, 8 benchmarks, 640 total, up from 572 before
this spec). Real check: a polyglot fixture with the same deliberately-shaped function (three
sequential `if`s vs. three nested `if`s) written in all 8 languages, synced via the real CLI —
every language produced the exact same pair (cyclomatic 4/4, cognitive 3/6), proving the shared
walker is correctly configured per language, not just per-parser-unit-tested in isolation.
Separately synced nodum's own ~80-file TypeScript codebase and confirmed all 217
complexity-scored nodes also carry `cognitiveComplexity` with zero regression to `complexity`
itself, and that `nodum complexity --cognitive` produces a genuinely different, sane ranking (real
example: `extractImports` in `python.ts` ranks #3 under cognitive complexity despite not
appearing in cyclomatic's top 6 — real evidence the metric captures different structure, not just
a rescaled copy of cyclomatic). Third and final spec in the v2.9.0 batch.

## Goal

Add a nesting-depth-aware complexity metric (cognitive complexity, SonarSource-inspired) alongside
the existing cyclomatic (McCabe) metric — an `if` three levels deep should cost more than three
sequential `if`s at the top level, which cyclomatic complexity, by design, cannot express.

## Why now

Originally deferred in spec 014 pending "cyclomatic + shared body-extraction plumbing" shipping
first across every language. That's now true for all 8 languages this codebase parses, following
spec 044's Kotlin migration (Kotlin's prior regex-based `complexity-text.ts` could never have
tracked real nesting depth at all — a hard prerequisite this spec's ordering explicitly waited on).

## Scope

**Partial centralization.** One shared, table-driven `computeCognitiveComplexity` walker
(`packages/core/src/parser/cognitive-complexity.ts`) is used by the 7 TSNode-based parsers
(Python, Java, JavaScript, Swift, Objective-C, Go, Kotlin); TypeScript keeps its own
`ts.Node`/`SyntaxKind`-native twin (`cognitive-complexity-ts.ts`) implementing the identical
algorithm — a `TSNode`↔`ts.Node` adapter would leak more (different child-iteration APIs, different
type-identity mechanisms) than it would save for one ~70-line walker; a considered-and-rejected
alternative, not an oversight. Each parser keeps a small `CognitiveConfig` describing *which node
types mean what* (matching where `COMPLEXITY_NODE_TYPES` already lives per-parser today for
cyclomatic) — only the *algorithm* (nesting-depth bookkeeping, boolean-sequence collapsing,
recursion detection) is shared.

- New `Node.cognitiveComplexity?: number` field (`types.ts`), set **alongside** `complexity`
  whenever a parser can determine a body — never repurposing or silently changing the existing
  cyclomatic field. **No existing `computeComplexity` function was touched** in any of the 8
  parsers.
- `rankByComplexity` (`analyzer/complexity.ts`) gains an optional `metric: 'cyclomatic' |
  'cognitive'` (defaults to `'cyclomatic'`, unchanged pre-spec behavior); `ComplexityRanking` gains
  a `metric` field so a JSON consumer can tell which one it's looking at.
- CLI's `nodum complexity` gains a `--cognitive` flag.
- `findBottlenecks`/`suggestRefactoring`/every MCP tool schema are **unchanged** — both keep
  calling `rankByComplexity` with the default metric. Deliberately not wired up further this spec
  (see Out of scope).

### The algorithm, exactly as implemented (SonarSource-*inspired*, not certified)

Baseline is **0** (not cyclomatic's 1) — a function with no branches has zero cognitive complexity.

- A nesting construct (`if`/`for`/`while`/`do-while`/`catch`/Swift's `guard`) costs
  `1 + currentNestingDepth`, and its own body is walked at `currentNestingDepth + 1`.
- A boolean-operator sequence (`a && b && c`) costs `+1` total, not once per operator — detected by
  checking each boolean node's **parent** (not a specific child): a boolean node whose own parent
  is also a boolean-op node is definitionally part of a chain some ancestor already counted, and is
  suppressed. **This had to be parent-based, not child-based** — a real bug found via this spec's
  own real-CLI verification, not caught by the first round of unit tests written against a single
  language: Python's grammar nests a boolean chain left-associatively (`(a&&b)&&c`), while Swift's
  nests right-associatively (`a&&(b&&c)`), verified empirically. A child(0)-based "is my left
  operand the same kind" check (the first implementation) worked for Python but overcounted Swift
  by exactly the chain length; checking the parent instead is correct regardless of which direction
  a given grammar happens to nest, fixed and covered by dedicated tests in both `python.test.ts`
  and `swift.test.ts` plus the shared walker's own unit tests.
- Recursion (a bare call whose callee name matches the enclosing unit's own name, passed as
  `selfName`) costs a flat `+1`.
- A lambda/closure body (not itself a separately-scored callable, unlike a named
  function/method) increments nesting depth for its descendants without a self-increment.

### Known, deliberate divergences from strict SonarSource semantics (documented, not silently wrong)

- **`else if` chains are not kept flat.** SonarSource scores `if / else if / else if` as one flat
  sequence at the same nesting level. This implementation's simplified depth model instead treats
  each successive `else if` as one level deeper than the last — in every grammar this codebase
  covers, an `else if` is structurally a nested `if` inside the outer `if`'s alternative branch, and
  this walker does not special-case that position. A real fix needs per-grammar "consequence vs.
  alternative" branch-field detection verified individually for all 8 languages — out of scope for
  this spec's time budget, tracked as a documented follow-up. Covered by a dedicated regression
  test in `python.test.ts` asserting the *actual*, divergent behavior (score 3, not SonarSource's
  2), so a future reader sees this as intentional, not an unnoticed bug.
- **Bare `else` (no condition) is not scored at all**, and neither is **`switch`/`when`** — per
  strict SonarSource semantics a `switch` counts once as a whole statement, not once per case
  (the opposite of how every language's existing cyclomatic `COMPLEXITY_NODE_TYPES` set already
  works), and determining each of the 8 grammars' exact switch-wrapping node shape needed more
  verification time than this spec's budget allowed. Both are real, useful signals left for a
  future follow-up rather than implemented imprecisely.
- **Ternary/conditional expressions are not scored.** Consistent with the above — out of scope
  alongside switch/when, not selectively included.
- **Boolean-sequence collapsing does not distinguish `&&` from `||`.** A mixed chain (`a && b ||
  c`) collapses to one `+1` here, same as a uniform chain — strict SonarSource additionally
  increments on an operator *change*. Not every grammar covered here exposes `&&` vs. `||` as a
  distinguishable category without an extra field lookup this spec's `CognitiveConfig` intentionally
  keeps out of its interface (`isBooleanOp` is boolean-valued, not category-valued).
- **Objective-C's block literals (`^{ }`) are not treated as `nestingOnly`** — unlike every other
  language's closure syntax here (Java's `lambda_expression`, JS's `arrow_function`, Swift's
  `lambda_literal`, Go's `func_literal`, Kotlin's `lambda_literal`, TS's `ArrowFunction`), ObjC
  block-literal parsing proved unstable enough during this spec's own grammar verification to leave
  untouched entirely rather than risk it — blocks simply walk through as regular container nodes,
  matching `computeComplexity`'s own existing (also block-unaware) cyclomatic behavior for ObjC.
- **ObjC recursion detection only covers bare C function calls**, not `[self foo]`/`[super foo]`
  self-message recursion — the `callSelector` helper needed for that isn't exported from `objc.ts`,
  and self-recursive Objective-C methods are rare enough in practice that inlining a duplicate of
  that helper wasn't judged worth the added surface for this spec.

## Out of scope

- Wiring `metric: 'cognitive'` into `findBottlenecks`'s composite score or `suggestRefactoring`'s
  complexity threshold — a cognitive threshold isn't the same number as cyclomatic's 10, and
  picking one needs real usage data this spec doesn't have. Both keep calling `rankByComplexity`
  with the default metric.
- Any MCP tool schema change — `find_bottlenecks`/`suggest_refactoring`'s tool definitions are
  unchanged; only the CLI's `complexity` command gained the new `--cognitive` flag this spec.
- Refactoring the existing 8 per-parser cyclomatic `computeComplexity` functions — none were
  touched, by design (see Scope).
- `switch`/`when`, bare `else`, ternary/conditional-expression scoring, `&&`/`||` operator-change
  detection, and true SonarSource-flat `else if` chains — all documented above as deliberate,
  time-boxed simplifications, not silently dropped.

## Acceptance criteria

- [x] Every one of the 8 languages' complexity-scored nodes also gets a `cognitiveComplexity` field
      whenever a body could be determined — verified against nodum's own real codebase (217/217).
- [x] `complexity` (cyclomatic) is unchanged by this spec on every existing test and on a real
      re-sync of nodum's own codebase (`nodum diff` — zero drift).
- [x] All 8 languages score the identical deliberately-shaped polyglot fixture identically
      (cyclomatic 4/4, cognitive 3/6) — verified via the real CLI, not just per-language unit tests.
- [x] A nested `if` scores higher cognitively than the same count of sequential `if`s, while scoring
      identically under cyclomatic — the core differentiator this metric exists to provide.
- [x] `rankByComplexity(graph, { metric: 'cognitive' })` can rank a node higher than another node
      that has higher cyclomatic complexity but lower cognitive complexity, and vice versa —
      verified with a dedicated test proving the two metrics can genuinely disagree.
- [x] `nodum complexity --cognitive` produces a real, different ranking on a real codebase, not a
      no-op or an error.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`cognitive-complexity.test.ts` (10 cases) and `cognitive-complexity-ts.test.ts` (9 cases) unit-test
the shared walker/twin in isolation: 0-baseline, nesting-depth arithmetic, sequential-vs-nested
scoring, boolean-sequence collapsing, recursion, boundary (no double-counting a nested callable),
and lambda/arrow-function depth-increment-without-self-increment. Each of the 8 parser test files
gained 4–6 cognitive-specific cases: 0-baseline, the sequential-vs-nested cyclomatic-4/cognitive-
3-or-6 case (the metric's own differentiator, asserted per language), boolean-chain collapsing,
self-recursion, and either a lambda-rolls-into-enclosing-unit case (7 of 8 languages) or a
two-independent-units-no-cross-contamination case (Java/JS, where the equivalent lambda case would
either not apply or intentionally diverges from other languages' boundary choice — see Design).
`analyzer/complexity.test.ts` (+3 cases) and `cli/commands/complexity.test.ts` (+1 case, plus one
pre-existing `toEqual` test updated for the new `metric` field) cover the `metric` option and
`--cognitive` flag through to the real ranking/CLI-output path.

## Success Metrics

- Real check: a polyglot fixture — the same deliberately-shaped function (three sequential `if`s
  vs. three nested `if`s) hand-written in all 8 languages — synced via the real CLI. Every single
  language produced the exact same `(cyclomatic, cognitive)` pair: `(4, 3)` for the sequential
  version, `(4, 6)` for the nested version. This is the real proof the shared walker's 7 per-language
  configs (plus the TS-native twin) are correctly wired, not just individually unit-tested against
  synthetic snippets that might have masked a config bug — which is exactly what happened during
  this spec's own development: the boolean-chain associativity bug (see Design) was caught by this
  real multi-language comparison surfacing a Swift-specific discrepancy that single-language unit
  tests, written and passing one language at a time, had not yet exercised.
- Real check: synced nodum's own ~80-file, 191-function/method TypeScript+multi-language codebase.
  All 217 complexity-scored nodes carry `cognitiveComplexity`; re-synced and diffed via `nodum
  diff` — zero drift (proving no accidental interaction with any other analyzer). `nodum complexity`
  vs. `nodum complexity --cognitive` produce genuinely different top-N rankings on this real data
  (e.g. `extractImports` in `python.ts` ranks #3 under cognitive complexity while not appearing in
  cyclomatic's top 6) — real evidence the metric captures nesting structure cyclomatic doesn't,
  not just a linearly-rescaled copy of the same ranking.

## Related

Third and final spec in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive
complexity). Depends on spec 044 (Kotlin's tree-sitter migration) for real nesting-depth-capable
Kotlin extraction to exist at all. Independent of spec 043 (Go) beyond both feeding into this
spec's polyglot verification fixture. Closes out v2.9.0; KMP and Dart/Flutter remain deferred to
future releases per the batch's own scoping (see the v2.9.0 plan and ROADMAP.md).
