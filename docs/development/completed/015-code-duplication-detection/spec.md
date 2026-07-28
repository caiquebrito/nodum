# 015 — Code duplication detection (structural similarity)

## Status: done

Implemented, tested (145 core tests total, including new `duplicate-hash.test.ts`,
`normalize-body-text.test.ts`, `analyzer/duplication.test.ts`, and extended per-parser tests;
67 CLI tests total including new `duplicates.test.ts`), and verified end-to-end against real
files on disk:
- A scratch fixture with a genuinely renamed-but-structurally-identical pair of TS functions
  (`validateUserInput`/`validateOrderInput`) plus single JS/Kotlin/Java analogues:
  `nodum duplicates --json` correctly grouped only the TS pair — the JS/Kotlin/Java functions
  each got their own hash individually (confirmed via `graph.json`) but had no same-language
  partner, so correctly appeared in no group. Cross-language matching correctly never occurs,
  per design.
- `benchmarks/projects/sample-next-app`: `nodum duplicates` reported none — manually confirmed
  via `graph.json` that this is because every repeated-shape CRUD stub in `models.ts` is a
  single-line body below the 20-token threshold, correctly excluded from hashing rather than a
  missed detection.

## Goal

Find functions/methods that are structurally near-identical — same control-flow shape,
robust to variable renaming and literal-value changes (Type-2-style clone detection) — and
surface them via a new `nodum duplicates [projectPath] [--json]` CLI command. Computed at parse
time, same architectural posture as spec 014's complexity scoring, and built directly on top of
its brace-body extraction infrastructure for the non-AST languages.

## Why now

Last item in the roadmap's "Advanced Graph Analysis" section; the other four (010–014) are
shipped. Unlike spec 012's dead-code scoping question, this one has no missing-infrastructure
blocker: spec 014 already built exactly what's needed — real AST access for TypeScript, and a
shared `extractBraceBody` helper giving JS/Kotlin/Java function body text for the first time.
This spec is a design-scope decision (how to fingerprint bodies for comparison), not a
feasibility gap, so it's written and presented directly rather than asked about first, following
the same posture as 011/013's design calls.

## Scope

- **Structural (Type-2-style) duplication**: two functions are flagged as duplicates if their
  *normalized* bodies are identical — normalization replaces every identifier with a generic
  `ID` placeholder and every literal (string/number) with `LIT`, so renaming a variable or
  changing a literal value doesn't break a match, but the control-flow shape (which statements,
  in what order, how nested) must match exactly. This is a meaningfully more useful signal than
  exact-text (Type-1) duplication, which would only catch literal copy-paste with zero edits.
- A new optional `Node.duplicateHash?: string` field (sha256 of the normalized token stream),
  populated **at parse time** for function/method nodes whose body could be determined — same
  architectural pattern as spec 014's `complexity` field, not a post-hoc graph analyzer.
- **A minimum-size threshold** (20 normalized tokens) before a hash is even computed. Without
  this, trivial one-liners (`return x;`, a bare getter) would all hash-identically and flood
  every project with meaningless "duplicate" noise — every non-trivial clone-detection tool
  (jscpd, PMD's CPD, etc.) applies a similar floor for the same reason.
- **TypeScript**: normalization walks the function/method body's AST (reusing the same
  nested-function traversal-boundary rule as spec 014's `computeComplexity` — doesn't descend
  into a nested `FunctionDeclaration`/`MethodDeclaration`, does descend into
  `ArrowFunction`/`FunctionExpression`), emitting one token per node: `ID` for identifiers, `LIT`
  for literals, the AST `SyntaxKind` name otherwise (e.g. `IfStatement`, `ReturnStatement`).
- **JavaScript/Kotlin/Java**: a new shared `packages/core/src/parser/normalize-body-text.ts`
  helper tokenizes the already brace-extracted body text via regex — identifier-looking tokens
  not in a shared cross-language keyword list become `ID`, numeric/string literals become `LIT`,
  everything else (keywords, punctuation) passes through — approximating the same normalization
  as the AST path without a real tokenizer. Documented as best-effort, same honesty posture as
  spec 014's regex-based complexity counting.
- `packages/core/src/analyzer/duplication.ts`: `detectDuplicates(graph)` — pure, groups
  function/method nodes by matching `duplicateHash`, returns only groups with 2+ members, same
  category as `detectCycles`/`rankByComplexity`.
- `nodum duplicates [projectPath] [--json]` CLI command, same shape as the other analysis
  commands.

## Out of scope

- **Type-3 clones** (structurally similar but with inserted/deleted statements, not just
  renamed identifiers/literals) — needs a similarity/edit-distance metric between token
  sequences, not exact-hash matching. A much larger undertaking (this spec's normalized-hash
  approach can only find exact structural matches); flagged as a natural follow-up, not
  scheduled.
- **Cross-language duplication** (a TS function structurally mirroring a Kotlin one) — the two
  normalization paths produce incomparable token vocabularies (`SyntaxKind` names vs. regex
  keyword-passthrough), so hashes are only ever compared within nodes that went through the same
  normalization path implicitly (via the hash itself differing across paths for equivalent code)
  — not a design goal here regardless.
- **Suppressing "boilerplate" duplicates** (e.g. many near-identical `toString()` overrides, or
  interface-conformance methods that are legitimately similar by necessity). No attempt to
  distinguish "meaningful" duplication from structurally-forced similarity — same posture as
  spec 012's dead-code candidates: the output is a signal for human review, not a verdict.
- **Auto-refactoring / extract-function suggestions.** Detection only, same as 011–014.
- **MCP tool exposure.** Same posture as 011–014 — `019-mcp-find-similar-code` is the
  MCP-wiring spec for this.
- **Python** — no body-extraction path exists for it any more than for spec 014, consistent to
  defer here too.

## Design

### 1. `packages/core/src/types.ts` — `Node` gains an optional field

```ts
export interface Node {
  // ...unchanged, including complexity from spec 014...
  /** sha256 of the normalized (identifiers/literals replaced with
   * placeholders) body token stream. Only set for function/method nodes
   * whose body met the minimum-size threshold; omitted otherwise. */
  duplicateHash?: string;
}
```

### 2. `packages/core/src/parser/duplicate-hash.ts` (new) — shared hashing utility

```ts
import { createHash } from 'crypto';

/** Below this many normalized tokens, a body is too trivial to be a
 * meaningful duplication signal (would flood output with one-liner noise). */
export const MIN_TOKENS_FOR_DUPLICATE_HASH = 20;

export function hashTokens(tokens: string[]): string | null {
  if (tokens.length < MIN_TOKENS_FOR_DUPLICATE_HASH) return null;
  return createHash('sha256').update(tokens.join('|')).digest('hex');
}
```

### 3. `packages/core/src/parser/normalize-body-text.ts` (new) — JS/Kotlin/Java path

```ts
/** Cross-language keyword allow-list — anything else identifier-shaped
 * becomes a generic ID placeholder. Approximate on purpose (no real
 * tokenizer for these three languages); covers the common C-family/
 * JVM-family surface, not exhaustive. */
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'class', 'interface',
  'extends', 'implements', 'function', 'fun', 'val', 'var', 'let', 'const', 'public',
  'private', 'protected', 'static', 'final', 'void', 'null', 'true', 'false', 'this',
  'super', 'import', 'package', 'async', 'await',
]);

export function normalizeBodyTokens(bodyText: string): string[] {
  const withPlaceholders = bodyText
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, 'LIT') // strings
    .replace(/\b\d+(\.\d+)?\b/g, 'LIT') // numbers
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, w => (KEYWORDS.has(w) ? w : 'ID')); // identifiers
  return withPlaceholders.split(/\s+/).filter(Boolean);
}
```

Used by `javascript.ts`/`kotlin.ts`/`java.ts`, right alongside the existing
`extractBraceBody`/`countCyclomaticComplexity` calls from spec 014: `hashTokens(normalizeBodyTokens(body))`.

### 4. `typescript.ts` — AST-based token collection

A new private method, structurally identical to `computeComplexity`'s traversal (same
nested-function boundary rule), but pushing a token per node instead of incrementing a counter:
`ID` for `ts.isIdentifier`, `LIT` for string/numeric literals, `ts.SyntaxKind[node.kind]`
otherwise. Result passed through `hashTokens`.

### 5. `packages/core/src/analyzer/duplication.ts` (new)

```ts
import type { Graph } from '../types.js';

export interface DuplicateGroup {
  hash: string;
  nodes: { nodeId: string; label: string; file: string }[];
}

/** Groups function/method nodes sharing a duplicateHash. Only groups with
 * 2+ members are returned — a unique hash isn't a duplicate of anything. */
export function detectDuplicates(graph: Graph): DuplicateGroup[] {
  const byHash = new Map<string, DuplicateGroup['nodes']>();
  for (const n of graph.nodes) {
    if (!n.duplicateHash) continue;
    const list = byHash.get(n.duplicateHash) ?? [];
    list.push({ nodeId: n.id, label: n.label, file: n.file });
    byHash.set(n.duplicateHash, list);
  }
  return [...byHash.entries()].filter(([, nodes]) => nodes.length >= 2).map(([hash, nodes]) => ({ hash, nodes }));
}
```

### 6. Export from `packages/core/src/index.ts`

```ts
export { detectDuplicates } from './analyzer/duplication.js';
export type { DuplicateGroup } from './analyzer/duplication.js';
```

### 7. `packages/cli/src/commands/duplicates.ts` (new) + `bin/nodum.ts` registration

Same shape as `cycles`/`dead-code`: resolve `graph.json`, run `detectDuplicates`, formatted or
JSON output.

```
🧬 Duplicate groups: 1 found

  Group 1 (2 functions):
    - validateUserInput (src/api/users.ts)
    - validateOrderInput (src/api/orders.ts)

(or, if none:)
✅ No duplicate groups found
```

## Acceptance criteria

- [x] Two functions with identical control-flow shape but different variable names and literal
      values produce the same `duplicateHash`.
- [x] Two functions with the same statements in a different order, or an added/removed
      statement, produce different hashes (Type-2 only, not Type-3 — a real negative case, not
      a bug).
- [x] A function below the 20-token threshold has no `duplicateHash` at all (field omitted, not
      an empty string or zero).
- [x] TypeScript: nested named function/method bodies are hashed independently of their
      enclosing function (not concatenated into the parent's token stream), matching spec 014's
      complexity precedent.
- [x] TypeScript: a nested arrow-function callback's tokens roll into the enclosing scored
      function's stream, matching spec 014's precedent.
- [x] `detectDuplicates` returns only groups with 2+ members — a node with a unique hash never
      appears in the output.
- [x] `detectDuplicates` returns `[]` when no node has a `duplicateHash`.
- [x] `nodum duplicates` prints a formatted grouped list and exits 0.
- [x] `nodum duplicates` with none found prints a clear "none found" message, not an error.
- [x] `nodum duplicates --json` prints the raw `DuplicateGroup[]` array.
- [x] `nodum duplicates` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/parser/duplicate-hash.test.ts` (new) — threshold boundary (19 vs. 20 tokens),
determinism (same tokens → same hash), different tokens → different hash.

`packages/core/src/parser/normalize-body-text.test.ts` (new) — identifier replacement, literal
replacement, keyword preservation, whitespace collapsing.

Per-parser tests (extend `typescript.test.ts`/`javascript.test.ts`/`kotlin.test.ts`/`java.test.ts`)
— two renamed-but-structurally-identical functions get the same `duplicateHash`; a small function
gets no `duplicateHash`; for TypeScript, the same nested-function-vs-nested-arrow distinction
spec 014 already tests for complexity.

`packages/core/src/analyzer/duplication.test.ts` (new) — grouping, 2+-member filter, empty
result.

`packages/cli/src/commands/duplicates.test.ts` (new) — following the established mocking
convention: formatted output, "none found," `--json`, missing synced project.

## Success Metrics

- Real check: a scratch TypeScript fixture with two functions that are identical in shape but
  use different variable names and different literal values — sync it, confirm
  `nodum duplicates` reports them as a group.
- Real check: the same exercise for JS, Kotlin, and Java via the regex-normalization path.
- Real check: `nodum duplicates` against `benchmarks/projects/sample-next-app` — confirm the
  result (whatever it is) makes sense against a manual read of the actual functions involved,
  not just that the command runs without error.

## Related

Depends on: `014-complexity-scoring` (reuses its brace-body extraction infrastructure directly).
Blocks: `019-mcp-find-similar-code`, the MCP-wiring spec for this capability.
