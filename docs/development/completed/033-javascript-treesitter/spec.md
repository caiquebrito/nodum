# 033 — Migrate JavaScript to tree-sitter

## Status: done

Implemented and tested (8 new cases in `javascript.test.ts`, alongside all 10 pre-existing ones,
which pass unmodified against the new implementation; full workspace suite — 252 core, 95 cli,
58 mcp, 8 benchmarks, 413 total — green). Real check: a real three-file JavaScript project
(ESM import, `require()`, a class with a constructor/instance method/static method, a
`for...of` + ternary + `&&` combination, a named arrow function, and a concise-body arrow)
synced with the real CLI. Every claimed fix landed correctly on the first run — see Success
Metrics.

## Goal

Replace `parser/javascript.ts`'s line-regex implementation with a tree-sitter-based one. Two
concrete, previously-undetected bugs: `javascript.ts` never set a `line` number on any node
(computed one internally purely to feed `extractBraceBody`, then discarded it — the only one of
the four regex parsers with this gap, and untested since no test anywhere in this codebase
asserted line numbers before now), and JS classes got zero member extraction at all — the old
parser created a class node and stopped, unlike every other language parser here.

## Why now

Last of the three tree-sitter language migrations in this batch, after Python (031) and Java
(032). TypeScript stays on the compiler API throughout — nothing here changes that; it remains
the one parser with genuinely high-fidelity resolved-type data.

## Scope

- **Line numbers, for the first time.** Every function/method/class node now carries a real
  `line`.
- **Real class-member extraction.** Classes previously got a node and nothing else. Now:
  `method_definition` children of a class's body (instance methods, static methods, getters —
  all the same node type in this grammar) are attributed to their class (`classId -> methodId`
  `defines` edge), matching the precedent Python (031) and Java (032) already established. Every
  `class_declaration`, at any depth, still gets a flat `fileId -> classId` edge, matching
  `TypeScriptParser`'s own behavior.
- **Three named-function shapes**, matched by one combined query: `function foo() {}` (the
  `function_declaration` itself is the function), `const foo = function() {}` and
  `const foo = () => {}` (the function/arrow's *name* comes from the enclosing
  `variable_declarator`, since `function_expression`/`arrow_function` nodes are themselves
  anonymous — the query captures the `value:` field node directly, not the declarator, so the
  body/complexity walk always operates on the real function node).
- **Real complexity**, now including a ternary (`ternary_expression`) and correctly
  distinguishing `for...of`/`for...in` (`for_in_statement` — one node type covers both in this
  grammar) from a C-style `for` (`for_statement`), and `switch_case` (matching the old
  *text*-based scorer's `\bcase\s+[^:]+:` pattern precisely — a bare `switch_default` /
  `default:` was never counted by the old regex, so it isn't counted now either, deliberately).
  `&&`/`||` counted via `binary_expression`'s `operator` field, same approach as Java (this
  grammar also uses one generic node for every binary operator).
- **Preserves the old parser's one deliberate limitation**: a concise-body arrow (`x => x + 1`,
  no braces) still gets **no** complexity/`duplicateHash` — its "body" is a bare expression, not
  a `statement_block`, and the pre-existing test asserting this (`"leaves a brace-less
  single-expression arrow function unscored"`) passes unmodified against the new implementation.
- **Real `duplicateHash`** — same normalized-token-stream scheme as the other tree-sitter
  parsers, extended with `property_identifier` (this grammar's node type for a method name) as an
  `ID` alongside plain `identifier`.
- `resolveImport()` is unchanged — still delegates to the shared `resolveRelativeImport()`.

## Out of scope

- Object-literal method shorthand (`{ foo() {} }`) — the old regex parser never handled these
  either (its `funcRegex` only matched `function`/`const`/`let`/`var` keyword patterns).
- Template-literal `require()` arguments (`` require(`./foo`) ``) — the old regex only matched
  quote characters, not backticks; same gap, not newly introduced.
- Getter/setter-specific semantics (e.g. distinguishing `get bar()` from a plain method) — both
  are the same `method_definition` node type in this grammar and are extracted identically,
  matching how the old parser (which extracted zero class members at all) drew no distinction
  either — there's no regression to speak of, just no new distinction added.
- Cross-file call resolution, `calls` edges — spec 034.

## Design

### Grammar shapes verified empirically before writing the parser

```
function foo() {}                → (function_declaration name: (identifier) ...)
const foo = function() {}        → (variable_declarator name: (identifier) value: (function_expression ...))
const foo = () => {}             → (variable_declarator name: (identifier) value: (arrow_function ...))
const foo = x => x + 1           → (arrow_function parameter: (identifier) body: (binary_expression ...))
                                    — body is a bare expression, NOT a statement_block, when concise
async function foo() {}          → (function_declaration ...) — identical shape; async is anonymous
class Foo { bar() {} }           → (class_declaration body: (class_body member: (method_definition
                                     name: (property_identifier) ...))) — property_identifier, not identifier
class Foo { static bar() {} }    → same shape — "static" doesn't change the node type
import { foo } from './foo'      → (import_statement source: (string (string_fragment)))
                                    — string.text includes quotes ('./foo'); fragment.text doesn't
require('./foo')                 → (call_expression function: (identifier "require") arguments: (arguments (string ...)))
if/else-if                       → nested if_statement via alternative: (else_clause (if_statement ...))
for (x of xs) / for (x in xs)    → both (for_in_statement ...) — ONE node type for both
for (let i=0;...)                → (for_statement ...) — distinct from for_in_statement
do {} while ()                   → (do_statement ...)
switch/case/default              → (switch_statement body: (switch_body (switch_case ...) (switch_default ...)))
a ? 1 : 2                        → (ternary_expression ...)
a && b                           → (binary_expression left: ... right: ...) — generic node, same as Java;
                                    childForFieldName('operator').text gives "&&"/"||"
```

## Acceptance criteria

- [x] Every function/method/class node carries a real `line` number.
- [x] A class's `method_definition` members (instance, static) are extracted as `method`-type
      nodes attributed to their class.
- [x] All three named-function shapes (`function foo`, `const foo = function(){}`,
      `const foo = () => {}`) are extracted uniformly.
- [x] A ternary and a `switch_case` are counted; a bare `default:` label is not.
- [x] `for...of`/`for...in` and a C-style `for` are each counted once, correctly, as distinct
      node types.
- [x] A concise-body arrow function still gets no complexity/`duplicateHash` — the pre-existing
      test for this passes unmodified.
- [x] All 10 pre-existing `javascript.test.ts` cases pass unmodified.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/javascript.test.ts` (extended, +8 cases) — line numbers (1: a function
past the first line), class extraction (4: method attribution, static-method attribution, method
complexity, a nested named function inside a method staying attributed to the file rather than
the class), complexity (3: ternary, switch-case-vs-default, for-of/do-while). The 10 pre-existing
cases (imports ×5, complexity ×3, duplicateHash ×2) needed no changes.

## Success Metrics

- Real check: a real three-file JavaScript project — `main.js` (ESM `import`, a `Greeter` class
  with a constructor, an instance method, and a static method; a top-level function combining
  `if`/`&&`/`for...of`/ternary; a named arrow function; a concise-body arrow) and two files it
  imports (one via ESM, one via `require()`) — synced with the real CLI. Actual output:
  `constructor`/`greet`/`create` all extracted as `method` nodes with `classId -> methodId`
  edges; `topLevel` scored complexity **5** (base 1 + if + `&&` + for-of + ternary); the concise
  arrow (`concise`) correctly got **no** complexity/hash while the named arrow (`arrow`) got
  complexity 1; every node carried a real `line`; both the ESM and `require()` imports resolved
  to real cross-file edges.

## Related

Depends on: 030 (`TreeSitterParser`, `getQuery`, `resolveImport()`). Independent of 031/032 — no
shared code between the three language migrations beyond what 030 provides. Last language
migration in this batch; TypeScript is untouched throughout. Blocks nothing.
