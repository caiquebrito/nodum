# 034 — Same-file calls edges

## Status: done

Implemented and tested (19 new cases across `typescript.test.ts`, `python.test.ts`,
`java.test.ts`, `javascript.test.ts` — 5 each for TS/Python/JS, 4 for Java; full workspace suite
green — 271 core, 95 cli, 58 mcp, 8 benchmarks, 432 total, up from 413 before this spec). Real
check: a real TypeScript file (a bare function-to-function call, a `this.x()` qualified call, and
a class) synced with the real CLI — see Success Metrics.

## Goal

Add a `calls` edge, emitted when a function/method calls another function/method **defined in
the same file**, resolved by a flat name lookup — the same simplification `defines` edges already
use. This is the prerequisite spec 012 explicitly deferred symbol-level dead code on ("symbol-level
dead code is deferred to a future spec that first adds call/reference-edge resolution"); this spec
lays that groundwork. It does not itself wire up a new analyzer.

## Why now

Last spec in the v2.3.0 tree-sitter batch. Python (031), Java (032), and JavaScript (033) all now
expose real per-node AST shapes via tree-sitter, and TypeScript already has them via the compiler
API — so every migrated parser can walk a function/method body and find calls to other same-file
functions/methods without inventing new infrastructure.

## Scope

- Add `'calls'` to `RelationType` (`types.ts`).
- Emit a `calls` edge from a function/method's node to another function/method's node **defined in
  the same file**, when the caller contains a **bare-identifier call** (`foo()`) whose callee name
  matches a function/method defined in that same file. Implemented in all four parsers that
  extract real function/method nodes: `typescript.ts` (a new `extractCalls` walking each collected
  `{nodeId, name, body}` unit against a `nameToNodeId` map built from all of them), and
  `python.ts`/`java.ts`/`javascript.ts` (same shape, using each grammar's own `call`/
  `method_invocation`/`call_expression` node type).
- **Only bare-identifier calls resolve.** `this.foo()`/`self.foo()`/`obj.foo()` (a qualified
  receiver) are deliberately excluded — see Out of scope.
- First-definition-wins on a name collision between two same-named callables in one file, matching
  every other extraction pass in each of these parsers.
- Self-recursive calls are legitimate and produce a self-loop edge (`nodeId -> nodeId`).
- Respects the same nested-function/method traversal boundary every parser already uses for
  `complexity`/`duplicateHash`: a call inside a nested function/method belongs to that nested
  unit, not the enclosing one — it's resolved on that unit's own turn in `callables`, not
  double-counted into the parent.
- **Kotlin is explicitly excluded** — it stays on its regex parser this release (per the v2.3.0
  plan), and regex-based call extraction isn't reliable enough to be worth adding.
- Both viewer copies (`packages/viewer/app.js`; `packages/server/viewer/app.js` is a gitignored
  build copy of it) give `calls` edges a distinct link color (`#c47f17`, vs. `#1a4d9e` for
  `imports`) and a directional arrowhead, so they no longer render identically to `defines`
  edges. `imports`-only directional flow particles are unchanged.

## Out of scope

- **Cross-file call resolution.** Same-file only, matching the plan's explicit scope-narrowing
  decision. A future spec's job.
- **Qualified calls** (`this.x()`, `obj.x()`, `self.x()`). Without real type information there's
  no reliable way to tell whether the receiver even refers to something in this file — resolving
  these would risk false-positive edges from an unrelated same-named function elsewhere in the
  file. This means the feature mostly captures function-to-function calls, not method-to-method
  calls (which are almost always written with a qualified receiver in every one of these
  languages) — a real, stated scope reduction, not an oversight.
- **Wiring `calls` edges into any analyzer.** `cycles.ts`, `dead-code.ts`, `architecture.ts`, and
  `impact.ts` all filter to `relation === 'imports'` explicitly and operate at file granularity;
  same-file `calls` edges are function/method-level, a different granularity entirely. Verified by
  reading all four — none needed changes, and none should consume this edge type yet. The
  consumer is the future symbol-level dead-code spec that 012 deferred to, not this spec.
- Kotlin call extraction (stays on regex parser this release).
- `require()`/dynamic-call resolution in JavaScript (`require` is never a locally-defined
  function, so it never resolves against `nameToNodeId` regardless).

## Design

### Grammar shapes verified empirically before writing the extraction code

```
Python:      call function: (identifier) @bare        vs  call function: (attribute object: (identifier) attribute: (identifier)) @qualified
Java:        method_invocation name: (identifier), no object: field  vs  method_invocation object: (this|identifier) name: (identifier)
JavaScript:  call_expression function: (identifier) @bare  vs  call_expression function: (member_expression object: ... property: ...) @qualified
TypeScript:  ts.isCallExpression(node) && ts.isIdentifier(node.expression)  — the TS compiler AST equivalent
```

### Two-pass shape, per parser

Each parser's `parse()` already does one pass collecting nodes/edges for functions, classes, and
their methods. This spec adds a `callables: {nodeId, name, body}[]` collected during that same
pass (one entry per function/method that has a body), then a second pass — `extractCalls` — run
once the full pass is done, so a call to a function declared *later* in the same file still
resolves (the `nameToNodeId` map is built from every callable up front, not incrementally).

## Acceptance criteria

- [x] `RelationType` includes `'calls'`.
- [x] A same-file bare-identifier call from one function/method to another produces exactly one
      `calls` edge, in all four parsers.
- [x] A qualified call (`this.x()`/`self.x()`/`obj.x()`) produces no edge.
- [x] A call to an unresolvable name (no same-file definition) produces no edge.
- [x] A self-recursive call produces a self-loop edge.
- [x] A call inside a nested function/method is attributed to that nested unit, not its enclosing
      parent.
- [x] `cycles`/`dead-code`/`architecture`/`impact` output is unaffected — verified by reading each
      analyzer's edge filter, all four already scoped to `relation === 'imports'` only.
- [x] Both viewer copies render `calls` edges with a visually distinct style from `defines`.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

New `describe("... calls edges")` blocks added to all four parser test files (`typescript.test.ts`
+5, `python.test.ts` +5, `java.test.ts` +4, `javascript.test.ts` +5): bare same-file call resolves;
qualified `this`/`self` call does not resolve; unresolvable name produces no edge; self-recursion
produces a self-loop edge; a nested function's call is attributed to the nested unit, not the
enclosing one (Java's test set omits the nested-function case — Java has no nested method
declarations to test against). All pre-existing cases in these four files pass unmodified.

## Success Metrics

- Real check: a TypeScript fixture file with a top-level `helper()` calling a top-level
  `double()`, and a `Calculator` class whose `add()` method calls `this.sum()`, synced with the
  real CLI. Actual `graph.json` output: exactly one `calls` edge,
  `src_util_ts__helper -> src_util_ts__double` — the qualified `this.sum()` call produced no edge,
  and no other edge in the graph carries `relation: "calls"` besides the one bare call. Matches
  the design exactly on the first run.

## Related

Depends on: 030 (`TreeSitterParser`/`getQuery` for Python/Java/JavaScript). Builds on 031/032/033
(the parsers whose bodies this spec now walks a second time). Lays groundwork for spec 012's
deferred symbol-level dead-code analysis — that future spec is the actual consumer of `calls`
edges; this spec only produces them. Last spec in the v2.3.0 tree-sitter batch (030–035); 035
(Graph type consolidation) is independent of this one.
