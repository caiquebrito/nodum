# 044 — Kotlin tree-sitter migration

## Status: done

Implemented and tested (33 cases in the rewritten `kotlin.test.ts`, including all 4 pre-existing
import tests kept unmodified as this migration's explicit contract, plus 1 pre-existing complexity
test intentionally updated for a documented behavior change; full workspace suite green — 392 core,
95 cli, 77 mcp, 8 benchmarks, 572 total, up from 565 before this spec). Real check: hand-built an
Android-shaped 3-file Kotlin fixture, synced it on the pre-migration parser and saved `graph.json`
as a baseline, then re-synced after migrating and compared — every `imports` edge identical,
`Status`'s type correctly flips `class → enum` (the one intentional breaking change), previously
misattributed flat "function" nodes for class/interface members become properly-attributed `method`
nodes with real `calls` edges, and a previously-silently-missed extension function (`slugify`) is
now correctly extracted — a real bug in the old regex parser, not present in this spec's design.
Re-synced again and confirmed zero drift via `nodum diff`. Second of three specs in the v2.9.0
batch.

## Goal

Migrate `KotlinParser` from line-regex extraction to `web-tree-sitter`, following the same plugin
pattern used for Python/Java/JavaScript/Swift/Objective-C/Go (specs 031–038, 043). Unlike those,
this is a rewrite of an existing parser rather than a new language.

## Why now

The old regex parser had real, load-bearing gaps: no `method` nodes (every class/interface member
became a flat file-attributed `function` node, silently colliding on id whenever two different
classes had a same-named method — `Repo#get` and `UserService#get` both normalized to the same
`..._get` id under the old scheme), no same-file `calls` edges (spec 034 never reached Kotlin), no
dedicated `enum` node type despite `NodeType` having had `enum` since spec 036, and — discovered
during this spec's own real-verification fixture, not anticipated going in — **extension functions
were silently never extracted at all** (`fun String.slugify()`'s receiver-qualified name doesn't
match the old regex's plain-identifier-only capture group, so the whole line simply fails to match;
no error, no warning, just a missing node). Ordered directly ahead of spec 045 (cognitive
complexity) because Kotlin's old regex-based `complexity-text.ts` cannot track real nesting depth
at all — a hard prerequisite for that spec.

## Scope

**One spec, not split into "grammar migration" and "capability upgrade."** Method/`calls`/`enum`
extraction all fall out of the same `class_body` traversal needed to get functions at all —
splitting would mean writing that traversal, discarding its results, then re-adding them. Risk is
isolated a different way: `resolveJvmImport` is untouched, and all 4 pre-existing import tests pass
unmodified — the migration's explicit, testable contract.

**Empirically probed the real `tree-sitter-kotlin.wasm` before writing any parser code** (this
project's established practice, per spec 037's precedent for Swift) — against both a realistic
multi-declaration fixture and the specific real-world idioms flagged as unverified during this
batch's scoping (Compose-style annotated/`suspend` functions, companion objects, secondary
constructors, extension functions, generics, lambdas, `when`, elvis, nested classes). Findings that
materially shaped the design:

- **This grammar carries no field names anywhere** — `childForFieldName` returns null for every
  node in every query, unlike every other tree-sitter grammar this codebase uses. All extraction is
  positional/type-based instead: a class's name is its direct `type_identifier` child; a function's
  name is its direct `simple_identifier` child; a function's body (if any) is its direct
  `function_body` child.
- **`rootNode.hasError` is `true` on syntactically valid, compact single-line Kotlin**
  (`interface Repo { fun get(): Int }`, `class D : Base() { override fun x() {} }`) but **`false`
  on the same code formatted across multiple lines** — the grammar appears to want statement
  terminators (newlines) around certain constructs that a single-line brace body omits. Verified the
  recovered tree is still fully correct and extractable even when `hasError` is true — the field is
  not gated on, and two regression tests cover the exact single-line snippets.
- **`interface`/`enum class` both parse as `class_declaration`** with a keyword *token* child (no
  field name) distinguishing them from a plain `class` — `enum class` carries both an `enum` and a
  `class` token child, so `enum` must be checked before falling through to the `class` default.
  `object`/`companion object` are distinct `object_declaration`/`companion_object` node types.
  `data`/`sealed` are `class_modifier` children, not distinct node types.
- **Top-level functions are found by walking `root.namedChildren` directly** (not a global query)
  — this single design choice is what keeps class methods, companion-object functions, and local
  (nested-inside-another-function) functions all correctly excluded from the top-level pass with
  *zero* exclusion-set bookkeeping: none of them are direct children of `source_file`, verified
  against annotated/`suspend`/`private` top-level functions (modifiers live *inside*
  `function_declaration`, never wrap it) and against a companion object and a local function (both
  confirmed to sit one level too deep to be picked up).
- **The 4 MB grammar-size concern flagged during scoping is empirically a non-issue**: measured
  `Language.load` at 8ms, parsing a 200KB file at 78ms, and a query over that tree at 10ms — no
  performance risk. The real, correctly-anticipated risk was grammar *fidelity*, addressed by the
  probing above rather than assumed away.
- Function body = child of type `function_body`, which is either a block (`statements` wrapper) or
  a bare expression (`= expr`) — both walk identically, so **expression-bodied functions now get
  real complexity/`duplicateHash` for the first time** (the old brace-counting regex returned null
  for a body with no `{`).

### Complexity: a documented, intentional behavior change

Kotlin's cyclomatic complexity now counts `if_expression` (an expression here, not a statement),
`for_statement`/`while_statement`/`do_while_statement`, `catch_block`, non-default `when_entry`
(Kotlin's switch-equivalent — **the old regex's `case:` pattern never matched Kotlin's `when`/`->`
syntax at all**, so `when` branches were never counted before this spec), `&&`/`||`
(`conjunction_expression`/`disjunction_expression`, dedicated node types here, no operator-field
check needed), and **`elvis_expression` (`?:`) — now counted**, reversing the old regex's
deliberate exclusion. That exclusion existed as a workaround for a bare `?` also appearing in
nullable-type syntax (`String?`) being indistinguishable from a ternary-like `?:` under plain text
matching — a concern that doesn't apply to a real AST, where `elvis_expression` is an unambiguous
node type. This matches `swift.ts`'s own `nil_coalescing_expression` precedent (Swift's `??`).

Traversal boundary (complexity, `duplicateHash`, `calls`): stops at a nested `function_declaration`,
but **descends into `lambda_literal`** (not separately extracted as its own node) — matching every
other tree-sitter parser's arrow-function/closure precedent in this codebase.

### Deliberate scope reductions (documented, not bugs)

- `object`/`data class`/`sealed class` all collapse to `'class'` (unchanged from before this spec)
  — no dedicated `NodeType` exists for any of them, and adding one is not a goal of this spec.
- **Companion object members are not extracted at all** — `companion_object` is a distinct node
  type, never walked by the direct-children member pass, so its functions are neither attributed to
  the enclosing class nor mistakenly surfaced as top-level functions. A dedicated test proves this
  deliberate gap.
- **Secondary constructors are not extracted** — `secondary_constructor` is likewise a distinct
  node type, skipped by the same direct-children-only member walk.
- **Local (nested-inside-another-function) functions are not extracted as their own nodes** — a
  direct consequence of the top-level pass walking only `source_file`'s direct children, and an
  explicit, tested parallel to `swift.ts`'s own local-function precedent.

## Out of scope

- Widening `NodeType` with a dedicated `object` type — `object`/`companion object` staying
  collapsed to `'class'` is unchanged from pre-migration behavior; not a goal here.
- Extracting companion-object members or secondary constructors — both are real, if less common,
  Kotlin features; deferred to a future spec if ever prioritized, same posture as this codebase's
  other documented parser scope reductions.
- Any change to `resolveJvmImport` or the dotted-FQN/wildcard import specifier format — this
  migration's explicit contract is that both stay byte-identical to pre-migration behavior.

## Design

See Scope above for the full empirically-verified grammar design (no field names, the
compact-single-line `hasError` quirk, `kotlinDeclKind()`'s keyword-token disambiguation, the
top-level-functions-via-direct-children approach, and the elvis/`when` complexity changes).

### Node identity: class/interface/file ids are stable; misattributed method ids are not, deliberately

A pre-existing class/interface/object/file node keeps the exact same id it had before this
migration (`normalizeNodeId` is unchanged, driven only by file path + name). A pre-existing
*method*, however, gets a **new** id: the old parser gave every class/interface member a flat,
name-only id (`normalizeNodeId(path, memberName, 'function')`), which could — and in real projects
would — collide whenever two different classes declared a same-named method. This migration gives
each method a type-qualified id (`normalizeNodeId(path, \`${typeName}#${memberName}\`, 'method')`),
matching every other JVM/Swift-family parser in this codebase. This is a deliberate identity
change, not an oversight — the old ids were already unsound; verified via `git diff --stat` that no
other code depends on a Kotlin method's specific pre-migration id format.

## Acceptance criteria

- [x] All 4 pre-existing import tests pass unmodified — `resolveJvmImport`/specifier format proven
      unchanged.
- [x] `interface`/`enum class` produce `'interface'`/`'enum'` nodes, not `'class'`; `data`/`sealed`
      class and plain `object` still collapse to `'class'`.
- [x] A class/interface method is attributed to its type via a `defines` edge, not a flat
      file-attributed function — including an interface's abstract (body-less) method.
- [x] Same-file bare-identifier `calls` edges resolve, including through a `lambda_literal`;
      qualified `this.x()`/`obj.x()` calls do not.
- [x] An extension function (previously silently missed entirely) is now correctly extracted.
- [x] Companion-object members and local (nested) functions are deliberately not extracted —
      verified by dedicated tests, not just absent by accident.
- [x] Extraction succeeds correctly on compact single-line Kotlin despite `hasError` being `true`
      on it (regression tests on the exact snippets probed during scoping).
- [x] `complexity-text.ts`, `brace-body.ts`, `normalize-body-text.ts` and their tests deleted — each
      had exactly one non-test consumer (the old `kotlin.ts`), confirmed by grep before deletion.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`kotlin.test.ts` rewritten from 8 to 33 cases across 6 `describe` blocks: imports (all 4 kept
unmodified), complexity (baseline, if/&&/for/elvis with the new elvis-counted behavior and its
rationale documented inline, while/do-while/catch/||, non-default `when` entries, an
expression-bodied function, lambda descent, no double-counting across nested/top-level functions),
type extraction (class/interface/enum/data-class/sealed-class/object, the two `hasError`-true
regression snippets, same-name class-vs-object collision), member extraction (method attribution,
an abstract interface method with no complexity, an extension function, a generic function, the
companion-object-skip and local-function-skip deliberate gaps), duplicateHash (both pre-existing
cases, structurally unaffected by the rewrite), calls edges (bare, qualified-unresolved, recursive,
through a `lambda_literal`, a same-class method-to-method call).

## Success Metrics

- Real check: built a 3-file Android-shaped Kotlin fixture (`data class`, `enum class`, an
  `interface` with an abstract method, an implementing `class` with `if`/`&&`/`for`/`else
  if`/`try`-`catch`, a same-file method-to-method call, an extension function, an `object`,
  wildcard + specific imports). Synced on the pre-migration parser and saved `graph.json` as a
  baseline; re-synced after migrating and compared by hand: every `imports` edge identical;
  `Status`'s type flips `class → enum` (the one intentional change); `get`/`helper` go from flat
  misattributed `function` nodes to properly-attributed `method` nodes with a new, hand-verified
  `calls` edge between them; `get`'s complexity hand-computed at 6 (base 1 + `if` + `&&` + `for` +
  `else if` + `catch`) matched exactly; `slugify` — silently absent from the pre-migration baseline
  entirely — is now correctly extracted, confirming the real regex gap this migration fixes. Ran
  `nodum diff` after a further re-sync: zero drift. Ran `nodum complexity`/`nodum
  suggest-refactoring` against the fixture — both completed cleanly, the latter correctly flagging
  `UserService.kt` as unimported dead code in this small fixture.
- Grammar performance, measured rather than assumed: `Language.load` 8ms, parsing a 200KB Kotlin
  file 78ms, a `class_declaration` query over that tree 10ms — the originally-flagged 4MB grammar
  size is not a real risk at this project's scale.

## Related

Second of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive
complexity). Independent of spec 043 (Go). A direct prerequisite for spec 045 (cognitive
complexity), which needs Kotlin's real nesting-depth-tracking AST to exist — the now-deleted
regex-based `complexity-text.ts` could never have supported it.
