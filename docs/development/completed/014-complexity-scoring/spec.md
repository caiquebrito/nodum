# 014 — Complexity scoring (cyclomatic)

## Status: done

Implemented, tested (121 core tests total, including new `brace-body.test.ts`,
`complexity-text.test.ts`, `analyzer/complexity.test.ts`, and extended per-parser tests; 62 CLI
tests total including new `complexity.test.ts`), and verified end-to-end against real files on
disk:
- Hand-built TS/JS/Kotlin/Java fixtures with an identical branchy function shape (`if`+`&&`,
  nested `for`+`if`, `else if`+`||`, and for TS a trailing ternary): `nodum complexity --json`
  returned exactly the hand-counted values — TS=8, JS=7, Kotlin=7, Java=7 — confirming both the
  AST path and the brace-matching + regex path are correct against real syntax, not just mocks.
- `benchmarks/projects/sample-next-app`: manually recomputed two real functions by hand —
  `authMiddleware` (1 base + 2 `if`s = 3) and `verifyToken` (1 base + 1 `catch` = 2) — both
  matched the tool's output exactly.
- **Caught and fixed along the way**: real end-to-end testing against the Java fixture surfaced
  a pre-existing bug in `java.ts`'s method-detection regex — `} else if (...)` was mis-parsed as
  a method declaration named `if` (matching `\w+\s+identifier\s*\(` against "else" + "if" +
  "("), producing a spurious node with a nonsense complexity score. Fixed with a narrow
  control-flow-keyword guard (not a general fix for this regex's broader fragility, which is
  out of this spec's scope), with a regression test added.

## Goal

Compute cyclomatic complexity for every `function`/`method` node the parsers already extract,
store it on the node itself, and surface it through a `nodum complexity [projectPath] [--json]
[--threshold N]` CLI command that ranks the most complex functions in a project.

**Scoped to cyclomatic complexity only, computed at parse time** — see Why now.

## Why now

The roadmap lists "Complexity scoring (cyclomatic, cognitive)" as one line. Before drafting this
spec I checked what each parser actually gives us to compute complexity from: **only
`typescript.ts` has a real AST** (via the `typescript` compiler package), with function bodies
already available as traversable nodes. `javascript.ts`, `kotlin.ts`, `java.ts`, and `python.ts`
are all line-by-line regex scanners — they find a function's *declaration* line but never
extract its *body*. There is no brace-matching or body-boundary logic anywhere in the codebase
today. Confirmed via `grep -n "class \|extends Parser"` and reading all five parser files.

Asked directly which scope to ship now — the answer: **cyclomatic complexity now** (a
well-defined, deterministic, industry-standard metric), computed precisely for TypeScript via
its real AST, and via a **new shared brace-matching helper** for JavaScript/Kotlin/Java (regex
body-extraction, with documented edge cases). Python stays out of scope, consistent with spec
010's precedent. **Cognitive complexity — a fundamentally different, nesting-sensitive algorithm
— is deferred to its own future spec** rather than bundled in here: shipping the harder
body-extraction plumbing first and validating it against real code lowers risk before adding a
second, trickier metric on top of the same foundation.

## Scope

- A new optional `Node.complexity?: number` field, populated at **parse time** (not a post-hoc
  graph analyzer like specs 011–013 — complexity is inherent per-function data available the
  moment a function is parsed, unlike cross-file concerns like cycles/dead-code/architecture).
- **TypeScript** (`typescript.ts`): computed by traversing each function/method's AST body node,
  counting: `IfStatement`, `ForStatement`, `ForInStatement`, `ForOfStatement`, `WhileStatement`,
  `DoStatement`, `CaseClause`, `CatchClause`, `ConditionalExpression` (ternary), and
  `BinaryExpression` nodes whose operator is `&&` or `||` — the standard McCabe decision-point
  set. Traversal does **not** descend into a nested `FunctionDeclaration`/`MethodDeclaration`
  (those are separately-extracted nodes that get their own score — not double-counted into the
  parent), but **does** descend into `ArrowFunction`/`FunctionExpression` bodies, since those
  aren't extracted as separate nodes today (a pre-existing parser limitation, not something this
  spec fixes — see Out of scope) and their branching should still count toward whatever
  enclosing scored unit contains them.
- **JavaScript/Kotlin/Java** (`javascript.ts`/`kotlin.ts`/`java.ts`): a new shared
  `packages/core/src/parser/brace-body.ts` helper extracts each function's body text via
  brace-depth counting (best-effort string-literal skipping so a `{`/`}` inside a string doesn't
  throw off the count), bounded to a short lookahead so a brace-less single-expression arrow
  (JS parser's `funcRegex` already matches `const foo = () => x + y` today, with no body braces
  at all) is correctly recognized as un-scoreable rather than accidentally consuming a
  *different*, later function's body. Complexity is then computed by counting the same
  decision-point keywords via regex over the extracted body text — **deliberately excluding
  ternary (`?:`) for these three languages**, since a bare `?` is a false-positive minefield in
  this group specifically (Kotlin nullable types `String?`, the Kotlin/Java elvis-adjacent and
  optional-parameter syntaxes) that a real AST doesn't have. Documented as a known, honest
  undercount for non-TypeScript languages, not silently hidden.
- `packages/core/src/analyzer/complexity.ts`: `rankByComplexity(graph, options?)` — a thin,
  pure, reusable ranking helper (sort function/method nodes by `complexity` descending, optional
  `options.threshold` filter), same category as `detectCycles`/`detectUnreachableFiles`, used by
  the new CLI command and available to future consumers (MCP tools).
- `nodum complexity [projectPath] [--json] [--threshold N]` CLI command, same shape as
  `cycles`/`dead-code`/`architecture`.

## Out of scope

- **Cognitive complexity.** A distinct, nesting-weighted algorithm (SonarSource's metric
  increments differently for nested vs. sequential structures, has special-cased rules for
  recursion, etc.) — a future spec's job once cyclomatic + the shared body-extraction plumbing
  have shipped and been validated against real code.
- **Python complexity scoring** — no body-extraction logic for Python exists any more than for
  the other regex-parsed languages, and Python import resolution was already deferred in spec
  010; consistent to defer here too.
- **Fixing the pre-existing arrow-function node-extraction gap.** TypeScript's parser only
  extracts `FunctionDeclaration`/`FunctionExpression`/class methods as nodes — a `const foo = ()
  => {...}` arrow function assigned to a variable is **not** a separately extracted node today
  (confirmed by reading `typescript.ts`'s `visitNode`). Its branches, if any, roll up into
  whatever enclosing scored function contains it (per the traversal rule above) rather than
  getting their own score. Not this spec's job to fix — flagging so the CLI's ranked output
  isn't misread as "every function in the file," just every function/method the parser already
  turns into a node.
- **Aggregate graph stats** (average/max complexity in `Graph.stats`). The per-node field plus
  the ranking CLI/helper is the useful surface; a stats rollup can be added later if wanted, not
  bundled here to keep this spec's footprint tight.
- **Auto-refactoring suggestions.** Detection/scoring only, same posture as 011–013.
- **MCP tool exposure.** Same posture as 011–013 — analysis/scoring + CLI now, MCP wiring is
  specs 016–020 (`017-mcp-find-bottlenecks` will consume this).

## Design

### 1. `packages/core/src/types.ts` — `Node` gains an optional field

```ts
export interface Node {
  // ...unchanged...
  /** Cyclomatic complexity (McCabe). Only set for function/method nodes whose
   * parser could determine a body; omitted (not zero) when unknown. */
  complexity?: number;
}
```

### 2. `packages/core/src/parser/brace-body.ts` (new)

```ts
/**
 * Extracts a function's body text via brace-depth counting, starting the
 * search at `startLineIdx`. Skips characters inside string/template
 * literals (best-effort — doesn't handle nested template expressions or
 * regex literals, a known limitation shared with the rest of these
 * regex-based parsers). Bounded to `maxLookaheadLines` before giving up, so
 * a brace-less single-expression arrow function doesn't accidentally
 * consume a later function's body. Returns null if no opening brace is
 * found within the lookahead window, or the body never closes.
 */
export function extractBraceBody(
  lines: string[],
  startLineIdx: number,
  maxLookaheadLines = 3,
): string | null {
  // depth-tracking char scan; see spec Design section for the algorithm.
}
```

### 3. `packages/core/src/parser/complexity-text.ts` (new)

```ts
/** Regex-based cyclomatic complexity over already-extracted body text.
 * Excludes ternary — see spec 014's Scope for why. */
export function countCyclomaticComplexity(bodyText: string): number {
  const patterns = [/\bif\s*\(/g, /\bfor\s*\(/g, /\bwhile\s*\(/g, /\bcatch\s*\(/g, /\bcase\s+[^:]+:/g, /&&/g, /\|\|/g];
  return 1 + patterns.reduce((sum, re) => sum + (bodyText.match(re)?.length ?? 0), 0);
}
```

Used by `javascript.ts`/`kotlin.ts`/`java.ts` after calling `extractBraceBody` for each matched
function/method line; `node.complexity` is set only when a body was successfully extracted.

### 4. `typescript.ts` — AST-based computation

A new private method, called once per extracted function/class-method node with that node's
`ts.Node` body, walking the subtree per the counted-construct list in Scope, skipping into
`FunctionDeclaration`/`MethodDeclaration` boundaries but not `ArrowFunction`/`FunctionExpression`.

### 5. `packages/core/src/analyzer/complexity.ts` (new)

```ts
import type { Graph, Node } from '../types.js';

export interface ComplexityRanking {
  nodeId: string;
  label: string;
  file: string;
  complexity: number;
}

export interface RankByComplexityOptions {
  threshold?: number;
}

export function rankByComplexity(graph: Graph, options: RankByComplexityOptions = {}): ComplexityRanking[] {
  return graph.nodes
    .filter((n): n is Node & { complexity: number } => n.complexity !== undefined)
    .filter(n => options.threshold === undefined || n.complexity >= options.threshold)
    .sort((a, b) => b.complexity - a.complexity)
    .map(n => ({ nodeId: n.id, label: n.label, file: n.file, complexity: n.complexity }));
}
```

### 6. Export from `packages/core/src/index.ts`

```ts
export { rankByComplexity } from './analyzer/complexity.js';
export type { ComplexityRanking, RankByComplexityOptions } from './analyzer/complexity.js';
```

### 7. `packages/cli/src/commands/complexity.ts` (new) + `bin/nodum.ts` registration

Same shape as `cycles`/`dead-code`: resolve `graph.json`, run `rankByComplexity`, print a
formatted top-N table or raw JSON.

```
🧮 Complexity ranking (top 10)

  12  parseTransaction (src/lib/parser.ts)
   8  validateInput (src/api/routes.ts)
   ...

(or, if no scored functions exist:)
✅ No scored functions found
```

## Acceptance criteria

- [x] A TypeScript function with N `if`/`for`/`while`/`case`/`catch`/ternary/`&&`/`||`
      constructs gets `complexity === N + 1`.
- [x] A TypeScript function's complexity does not include a nested named function's or class
      method's branches, but does include a nested arrow-function callback's branches.
- [x] A JS/Kotlin/Java function with the same constructs (excluding ternary) gets the matching
      `N + 1` score via the brace-body + regex path.
- [x] A brace-less single-expression arrow function (JS) is left with no `complexity` field
      (not a wrong number, not a crash) rather than absorbing a different function's body.
- [x] A function containing a string literal with `{`/`}`/`if`/`&&`-looking text inside it does
      not have its complexity inflated by the string's contents (best-effort — exact per the
      brace-skipping/string-skipping logic, not claiming perfect tokenization).
- [x] `rankByComplexity` sorts descending and respects `options.threshold`.
- [x] `rankByComplexity` returns `[]` when no node has a `complexity` field.
- [x] `nodum complexity` prints a formatted top-N ranking and exits 0.
- [x] `nodum complexity --threshold N` filters correctly.
- [x] `nodum complexity --json` prints the raw `ComplexityRanking[]` array.
- [x] `nodum complexity` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/parser/brace-body.test.ts` (new) — same-line brace, next-line (Allman-style)
brace, string literal containing braces, brace-less input (returns null), unterminated body
(returns null).

`packages/core/src/parser/complexity-text.test.ts` (new) — `countCyclomaticComplexity` against
hand-constructed bodies with known counts for each construct.

Per-parser tests (extend `typescript.test.ts`/`javascript.test.ts`/`kotlin.test.ts`/`java.test.ts`)
— assert `result.nodes.find(...).complexity` for representative real syntax per the acceptance
criteria above, including the nested-arrow-vs-nested-function distinction for TypeScript.

`packages/core/src/analyzer/complexity.test.ts` (new) — `rankByComplexity` sort order, threshold
filter, empty-result case.

`packages/cli/src/commands/complexity.test.ts` (new) — following the established mocking
convention: formatted output, `--threshold`, `--json`, missing synced project.

## Success Metrics

- Real check: a scratch TypeScript fixture with a function containing a deliberately known mix
  of `if`/`for`/ternary/`&&` — sync it, confirm the exact hand-counted complexity number appears
  in `nodum complexity --json`.
- Real check: the same exercise for a JS, Kotlin, and Java fixture via the brace-matching path
  (ternary excluded from the hand-count, per Scope).
- Real check: `nodum complexity` against `benchmarks/projects/sample-next-app`, manually
  recomputing the complexity of at least one real function by hand and confirming it matches —
  not just that the command runs without error.

## Related

Depends on: nothing new structurally — builds on the existing parser architecture, same
foundation specs 010–013 extended.
Blocks: `017-mcp-find-bottlenecks` (wants complexity data), a future
`complexity-scoring-cognitive` spec (not yet numbered) that would build on this one's
body-extraction plumbing.
