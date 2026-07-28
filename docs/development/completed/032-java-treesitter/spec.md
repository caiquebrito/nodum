# 032 — Migrate Java to tree-sitter

## Status: done

Implemented and tested (6 new cases in `java.test.ts`, alongside all 9 pre-existing ones, which
still pass unmodified against the new implementation — none of them asserted `node.type`
explicitly, so the class/method-attribution upgrade didn't break them; full workspace suite —
244 core, 95 cli, 58 mcp, 8 benchmarks, 405 total — green). Real check: a real two-file Java
project (a class with a constructor, an else-if chain, an enhanced-for loop, and a cross-file
import) synced with the real CLI. Every claimed fix landed correctly on the first run — see
Success Metrics.

## Goal

Replace `parser/java.ts`'s line-regex implementation with a tree-sitter-based one. Java's method
regex was the clearest evidence in the whole codebase that regex parsing was losing: it needed a
`CONTROL_FLOW_WORDS` guard (the file's own comment admitted this "isn't an exhaustive fix... e.g.
`return foo(` has the same shape") just to avoid matching `} else if (...)` as a method
declaration named `if`. Constructors were missed entirely, since `public Foo(int x)` doesn't have
the two words-before-paren shape the method regex required once `public` is consumed as a
modifier.

## Why now

Second language migration, following Python (031). Independent of Python — no shared code between
the two beyond what 030's engine/registry already provides. Ordered before JavaScript (033)
mostly to keep the two JVM-family languages (Java here, Kotlin unmigrated) fresh in mind for the
shared `resolveJvmImport` verification.

## Scope

- Real class/interface/method/constructor extraction via tree-sitter queries and direct field
  access — no more regex, no more `CONTROL_FLOW_WORDS` patch list.
- **Constructors, previously missed entirely** — extracted as `type: 'method'` nodes labeled with
  the class name (matching Java's own syntax: a `constructor_declaration`'s `name:` field is
  always the enclosing class's name), attributed to their class the same way regular methods are.
- **Methods (and now constructors) are attributed to their class or interface** —
  `${TypeName}#${methodName}`-style node id, `classId -> methodId` `defines` edge — instead of
  flattened to `fileId -> methodId` the way the old regex parser (and every method, indiscriminate
  of nesting) did. This mirrors the precedent `TypeScriptParser` already set, and the one spec 031
  just established for Python: every `class_declaration`/`interface_declaration`, at any nesting
  depth, still gets a flat `fileId -> id` edge (matching `TypeScriptParser`'s own behavior, which
  doesn't track enclosing-class scope for class edges, only for their members) — but each type's
  *own direct* member methods/constructors go to *that* type, not the file. Because a method in
  this grammar is always a direct child of exactly one class/interface body, no exclusion-tracking
  is needed the way Python's simpler (no interfaces, one nesting level typically) case needed it —
  each class/interface found via the query independently processes only its own direct members.
- **Real complexity**, including a ternary (`ternary_expression` — this grammar's name for what
  TS/Python call a conditional expression; same spec-014 ternary-exclusion history as Python) and
  two node types the old regex never distinguished at all: `enhanced_for_statement` (`for (T x :
  xs)`) and `do_statement` (do-while), both counted as decision points same as a regular `for`.
  `&&`/`||` are counted by checking `binary_expression`'s `operator` field text — this grammar
  uses one generic `binary_expression` node for *every* binary operator (arithmetic, comparison,
  logical), unlike Python's dedicated `boolean_operator` type, so the operator itself has to be
  inspected (the same shape of check `TypeScriptParser.computeComplexity` already does for JS/TS).
- **Real `duplicateHash`** — normalized token stream from tree-sitter node types, same scheme as
  Python/TypeScript.
- `resolveImport()` is unchanged from spec 030 — still delegates to the one shared
  `resolveJvmImport()`, verified this migration doesn't disturb Kotlin's use of the same function.

## Out of scope

- `enum_declaration`/`record_declaration` extraction — Java's grammar has distinct node types for
  these (confirmed empirically), but the old regex parser's `class\s+` pattern never matched
  either, and `NodeType` has no `'enum'`/`'record'` member to extend into. Adding either is a
  `NodeType` schema change with its own ripple (batched, not incremental, per how the roadmap
  treats vocabulary extensions) — left for a future spec if it's ever wanted.
- Overload-aware method extraction — two constructors or methods sharing a name within one class
  collapse to the first one found, same "first name wins" posture as every parser in this
  codebase (including the old regex Java parser's own per-file `seenNames`).
- Local/anonymous classes' own nested methods being excluded from an *enclosing* method's
  complexity/hash traversal — the boundary rule only excludes nested
  `method_declaration`/`constructor_declaration`, not a nested `class_declaration`'s members
  specifically; sufficiently rare in practice not to warrant the extra traversal complexity here.
- Cross-file call resolution, `calls` edges — spec 034.

## Design

### Grammar shapes verified empirically before writing the parser

```
class A { void foo() {} }              → (method_declaration type: ... name: (identifier) ... body: (block))
class A { public A(int x) {...} }      → (constructor_declaration name: (identifier) ... body: (constructor_body ...))
                                          — `name:` is always the class name, by Java's own syntax
interface A { void foo(); }            → (method_declaration ... )  — NO body: field at all (abstract)
if (x) {} else if (y) {}               → (if_statement ... alternative: (if_statement ...))
                                          — else-if is nested if_statement, not a distinct "elif" node
for (int x : xs) {}                    → (enhanced_for_statement ...) — distinct from for_statement
do {...} while (x)                     → (do_statement ...)
a && b || c ? 1 : 2                    → (ternary_expression condition: (binary_expression ...) ...)
a && b                                 → (binary_expression left: ... right: ...) — same node type as
                                          ALL binary operators; childForFieldName('operator').text
                                          gives "&&"/"||" to distinguish logical from arithmetic/comparison
import com.example.Foo;                → (import_declaration (scoped_identifier)) — .text is the full dotted path
import com.example.*;                  → (import_declaration (scoped_identifier) (asterisk))
import static com.example.Foo.BAR;     → (import_declaration (scoped_identifier)) — "static" is an anonymous
                                          token, doesn't appear as a field; scoped_identifier.text already
                                          includes the full "com.example.Foo.BAR"
```

### `parser/java.ts` — one query for both class and interface

```ts
const TYPE_QUERY = `
  (class_declaration name: (identifier) @name) @def
  (interface_declaration name: (identifier) @name) @def
`;
```
`defNode.type` (checked at capture time, not via two separate queries) distinguishes `'class'`
from `'interface'`. Each match's `body` field's direct children of type `method_declaration` or
`constructor_declaration` become that type's own methods.

### Import extraction — reading `.text` directly, no manual scope/name walking

```ts
for (const importDecl of root.descendantsOfType('import_declaration')) {
  let dottedNode = null, isWildcard = false;
  for (let i = 0; i < importDecl.childCount; i++) {
    const child = importDecl.child(i);
    if (child.type === 'scoped_identifier' || child.type === 'identifier') dottedNode = child;
    if (child.type === 'asterisk') isWildcard = true;
  }
  if (dottedNode) imports.push(isWildcard ? `${dottedNode.text}.*` : dottedNode.text);
}
```
Simpler than anticipated — `scoped_identifier.text` is already the full dotted path as written in
source (e.g. `"com.example.Foo.BAR"`), so there's no need to manually recurse through nested
`scope:`/`name:` fields the grammar uses internally to represent a dotted chain.

## Acceptance criteria

- [x] `} else if (...)` never produces a phantom method named `if` — verified as structurally
      impossible (an `if_statement`'s `alternative` field, not a method-shaped regex match), not
      merely guarded against.
- [x] A constructor is extracted as a `method`-type node labeled with its class name, attributed
      to that class.
- [x] `&&`/`||` are counted via the `binary_expression` operator field, not by string-matching;
      other binary operators (`+`, `==`, `<`, etc.) are not.
- [x] `enhanced_for_statement` and `do_statement` are each counted as their own decision point,
      distinct from `for_statement`.
- [x] A ternary is counted (previously excluded across all three regex-scored languages).
- [x] All 9 pre-existing `java.test.ts` cases pass unmodified.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/java.test.ts` (extended, +6 cases) — constructor extraction and its
class attribution, a plain method's class attribution (and the *absence* of a `fileId ->
methodId` edge), an interface method's attribution to the interface, an interface method with no
body producing no complexity/hash without throwing, ternary complexity, and
enhanced-for/do-while complexity. The 9 pre-existing cases (imports ×4, the else-if regression
×1, complexity ×2, duplicateHash ×2) needed no changes — none asserted `node.type`.

## Success Metrics

- Real check: a real two-file Java project — `Foo.java` (constructor, an else-if chain, an
  enhanced-for loop, a cross-file import of `com.example.util.Helper`) and `Helper.java` — synced
  with the real CLI. Actual output: no `if`-named node anywhere; `Foo`'s constructor extracted as
  a `method` node labeled `"Foo"`; `process` scored complexity **3** (base 1 + the outer
  `if_statement` + the nested `if_statement` in its `alternative` field — confirming an else-if
  chain is correctly counted as two decision points via nested-if traversal, not a distinct
  "elif" node the way Python has one); `withLoop` scored complexity **2** (base 1 +
  `enhanced_for_statement`); the cross-file import edge `Foo.java -> Helper.java` resolved
  correctly via the unchanged, shared `resolveJvmImport()`.

## Related

Depends on: 030 (`TreeSitterParser`, `getQuery`, `resolveImport()`). Independent of 031 (Python) —
no shared code beyond 030. Verifies `resolveJvmImport()` (shared with `KotlinParser`, which stays
on regex) is unaffected by this migration. Blocks nothing in this batch.
