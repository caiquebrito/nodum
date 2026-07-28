# 031 — Migrate Python to tree-sitter

## Status: done

Implemented and tested (24 new cases in `python.test.ts`, 7 new in `import-resolver.test.ts`
covering `resolvePythonImport`; full workspace suite — 238 core, 95 cli, 58 mcp, 8 benchmarks,
399 total — green). Real check: hand-built a 6-file fixture project covering every case this
spec claims to fix — absolute imports, package (`__init__.py`) imports, bare and explicit relative
imports, `async def`, ternaries, and a class/function name collision — synced it with the real
CLI, and inspected the actual `graph.json`. Every case landed correctly on the first real run; see
Success Metrics for the exact output.

## Goal

Replace `parser/python.ts`'s line-regex implementation with a tree-sitter-based one. Python was
the weakest of the four regex parsers by a wide margin: its import-extraction loop
(`python.ts:67-71`, pre-030) was dead code — a `while` whose body was a bare comment — so every
Python project produced zero cross-file `imports` edges while `nodum sync` reported success.
Cyclomatic complexity and `duplicateHash` didn't exist for Python at all, and there was no test
file for it whatsoever.

## Why now

First real language migration in the batch, immediately following 030's engine/registry plumbing.
Chosen first (ahead of Java/JavaScript) because it has the most to gain — every other regex
parser at least extracted *something* correctly; Python's import extraction extracted nothing.

## Scope

- **Real imports**, replacing the dead loop. Handles: `import x`, `import x.y` (dotted), comma-
  separated bare imports (`import os, sys` — each name is its own module), aliased imports
  (`import x as y` — resolves the real module, not the alias), `from x import a, b` (module
  resolved once, not per imported name — matching how the from-import cares about the *module*,
  same posture as TS/JS's `import { a, b } from './x'`), parenthesized multi-name from-imports,
  and relative imports in both forms — `from . import sibling` (bare — the imported name doubles
  as the candidate sibling module) and `from .pkg import thing` (explicit dotted module).
- **New `resolvePythonImport()`** in `parser/import-resolver.ts`, alongside the existing
  `resolveRelativeImport`/`resolveJvmImport`. Two resolution strategies depending on the
  specifier's leading dots: absolute imports are suffix-matched against known file paths (the
  same pragmatic choice `resolveJvmImport` already makes for Java/Kotlin — Python has no single
  enforced source-root convention either); relative imports are resolved to an *exact* path from
  the importing file's own directory, since a relative import's target is unambiguous. Both try
  `<path>.py` and `<path>/__init__.py`.
- **Real complexity, including ternaries** — the old regex-based `complexity-text.ts` deliberately
  excluded ternaries across all three of its languages (spec 014, to dodge a Kotlin `String?`
  false-positive under regex matching). Tree-sitter's `conditional_expression` node type is
  unambiguous, so there's nothing to dodge for a tree-sitter-based parser — Python's ternaries are
  counted from day one.
- **Real `duplicateHash`** — a normalized token stream from tree-sitter node types
  (`ID`/`LIT`/node-type-name), same shape as `TypeScriptParser.collectNormalizedTokens`.
- **Fixes the shared-`seenNames` collision** (old `python.ts:24,31,50` used one `Set` for both
  functions and classes — a class `Foo` and function `Foo` in the same file would silently drop
  one). Separate tracking per node kind now, plus per-class method tracking.
- **Fixes the `^\s*def` anchor that couldn't match `async def`** — tree-sitter matches
  `function_definition` by node type regardless of the `async` keyword, so this class of bug is
  structurally impossible now, not just patched.
- **New: methods are attributed to their class**, not the file — `ClassName#methodName`-style
  node id, `type: 'method'`, and a `classId -> methodId` `defines` edge, matching
  `TypeScriptParser`'s existing precedent exactly. The old regex parser flattened every `def`
  (including indented methods) into file-level `function` nodes; this was never a deliberate
  design decision, just a consequence of matching lines independently of scope. Every other
  `function_definition` — top-level, or nested inside another function (a closure) — still gets a
  flat `fileId -> funcId` edge, again matching `TypeScriptParser`'s own recursive-visit behavior
  precisely (it doesn't track enclosing-function scope for edge emission, only for the
  complexity/hash traversal boundary).
- `packages/core/src/parser/python.test.ts` (new) — didn't exist before this spec.

## Out of scope

- Distinguishing `async def` in the graph itself (e.g. an `isAsync` flag) — extracted identically
  to a regular function, since nothing downstream currently consumes such a distinction.
- Decorator-aware semantics (e.g. treating `@property` differently from a plain method) — every
  decorated function/method is extracted the same way as an undecorated one, matching how the old
  regex parser already treated them (decorator and `def` are on separate lines, so the regex
  parser incidentally already got this right for line-based reasons, not a deliberate contract this
  spec preserves particularly carefully).
- A function or class nested inside a function nested inside a class — several levels of
  edge-case nesting were not specifically tested; the traversal boundary rules (don't descend into
  a nested `function_definition`) are the same ones already proven correct for TypeScript, applied
  consistently.
- Cross-file call resolution, `calls` edges — spec 034.
- Build-system-aware Python import resolution (e.g. reading `pyproject.toml`/`setup.cfg` for
  actual package roots) — the suffix-matching approach is the same pragmatic bar `resolveJvmImport`
  already accepted for Java/Kotlin.

## Design

### 1. `packages/core/src/parser/python.ts` — full tree-sitter rewrite

Extends `TreeSitterParser` (spec 030), `grammarFile = 'tree-sitter-python.wasm'`. Two query
constants compiled once (via `getQuery`, cached):

```ts
const FUNCTION_QUERY = '(function_definition name: (identifier) @name) @def';
const CLASS_QUERY = '(class_definition name: (identifier) @name) @def';
```

Classes are processed first, walking each `class_definition`'s `body` block's direct children
(`function_definition`, or `decorated_definition` wrapping one) to attribute methods — their
`startIndex` is recorded in a `Set<number>` so the generic function pass below can skip them
(object identity across separate `descendantsOfType`/query calls isn't reliable in
`web-tree-sitter`; `startIndex` — a stable byte offset — is used as the identity key instead).

`extractImports()` is a direct tree walk via `root.descendantsOfType(['import_statement',
'import_from_statement'])`, **not** a query — unlike function/class extraction (a flat
capture-per-match), import specifiers need per-statement branching (a bare `import a, b` is two
module specifiers; `from x import a, b` is one) that doesn't map cleanly onto flat query captures.

### 2. Grammar shapes actually verified before writing the parser

Confirmed empirically (not assumed from documentation) against the real
`tree-sitter-python.wasm` this repo now ships, since query field names drift between grammar
versions:

```
def foo():                    → (function_definition name: (identifier) ...)
async def foo():              → (function_definition ...)                    — same node type
@decorator\ndef foo():        → (decorated_definition definition: (function_definition ...))
class Foo: def bar(self): ... → (class_definition body: (block (function_definition ...)))
import os.path                → (import_statement name: (dotted_name (identifier) (identifier)))
import os as o                → (import_statement name: (aliased_import name: (dotted_name ...) alias: ...))
from os import path, sep      → (import_from_statement module_name: (dotted_name ...) name: (dotted_name ...) name: (dotted_name ...))
from . import sibling         → (import_from_statement module_name: (relative_import (import_prefix)) name: (dotted_name ...))
from .pkg import thing        → (import_from_statement module_name: (relative_import (import_prefix) (dotted_name ...)) ...)
x = "str"                     → (string (string_start) (string_content) (string_end))  — treated as one LIT leaf
x = a and b or c              → (boolean_operator ...) — always and/or in this grammar, no operator-token check needed
```

### 3. `parser/import-resolver.ts` — `resolvePythonImport`

```ts
export function resolvePythonImport(
  specifier: string,
  importingFilePath: string,
  knownFileIds: Set<string>,
  knownFilesByPath: Map<string, string>,
): string[] {
  const match = specifier.match(/^(\.*)(.*)$/);
  const dots = match ? match[1] : '';
  const segments = (match ? match[2] : specifier) ? (match ? match[2] : specifier).split('.') : [];

  if (dots.length === 0) {
    // absolute — suffix match, same posture as resolveJvmImport
    for (let drop = 0; drop < segments.length; drop++) { /* try progressively shorter suffixes */ }
    return [];
  }

  // relative — exact path from the importing file's own directory;
  // one dot = "this package", each extra dot = one more parent level up
  let dir = dirname(importingFilePath);
  for (let i = 1; i < dots.length; i++) dir = dirname(dir);
  // try `<dir>/<segments>.py` and `<dir>/<segments>/__init__.py`
}
```

## Acceptance criteria

- [x] `import os.path` and `from os import path` produce raw specifiers wired through
      `resolveImport()`, producing real cross-file `imports` edges for the first time.
- [x] `async def foo()` is extracted identically to `def foo()`.
- [x] A ternary (`x if cond else y`) is counted toward complexity.
- [x] A file with both a class `Foo` and a function `Foo` gets both nodes — no collision.
- [x] A method inside a class gets `type: 'method'` and a `classId -> methodId` edge, not a
      `fileId -> methodId` one.
- [x] `python.test.ts` exists with coverage matching `java.test.ts`/`kotlin.test.ts`'s rigor, plus
      the cases those don't need (async, class/function collision, line numbers).
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/python.test.ts` (new, 24 cases) — imports (11: absolute, dotted,
comma-separated, aliased, from-import module-once semantics, parenthesized, both relative forms,
no-imports case), function/class extraction (6: top-level, async, decorated, class/function
collision fix, decorated method, nested-closure-not-attributed-to-class), complexity (4: zero
decision points, if/and/for/ternary combined, nested-function non-double-counting, class method),
duplicateHash (3: renamed-but-identical, too-small-for-a-hash, nested-function isolation).

`packages/core/src/parser/import-resolver.test.ts` (extended, 7 new cases) — absolute dotted
module, absolute package (`__init__.py`), bare relative, explicit relative, two-level-up relative,
external absolute (no match), relative with no match.

## Success Metrics

- Real check: a 6-file fixture (`main.py` importing stdlib modules, a dotted submodule
  `pkg.util`, a package `pkg`, a bare relative sibling, and an explicit relative module aliased
  with `as`; a `Greeter` class with `__init__`/`greet` methods; a top-level function with
  `if`/`and`/`for`/ternary; an `async def`), synced with the real CLI. Actual output: `top_level`
  scored complexity **5** (base 1 + if + and + for + ternary — the ternary alone is new for
  Python), `async_top_level` extracted correctly (would have been silently missed by the old
  `^\s*def` regex), `Greeter.__init__`/`Greeter.greet` attributed as `method` nodes with
  `classId -> methodId` edges (complexity 1 and 2 respectively), and three real `imports` edges
  landed: `main.py -> pkg/util.py` (dotted absolute), `main.py -> pkg/__init__.py` (both the
  absolute `from pkg import sibling` and the relative `from .pkg import thing as t` resolved to
  the same file, correctly deduplicated into one edge), `main.py -> local_sibling.py` (bare
  relative). Stdlib imports (`os`, `os.path`, `sys`, `json`, `collections`) correctly produced no
  edges — nothing in the fixture could resolve them, as expected.

## Related

Depends on: 030 (`TreeSitterParser`, `getQuery`, `resolveImport()`/`ignoredDirs` extension
points). Independent of 032/033 (Java/JavaScript) — no shared code between the three language
migrations beyond what 030 already provides. Blocks nothing in this batch.
