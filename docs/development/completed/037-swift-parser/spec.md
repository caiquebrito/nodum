# 037 — Swift parser (tree-sitter)

## Status: done

Implemented and tested (31 new cases in `swift.test.ts`; full workspace suite green — 306 core,
95 cli, 60 mcp, 8 benchmarks, 469 total, up from 438 before this spec). Real check: a hand-built
SPM-shaped fixture (`Sources/Networking/APIClient.swift`, `Sources/Networking/Parsing.swift`,
`Sources/App/main.swift`) synced with the real CLI — every claimed extraction, complexity score,
`calls` edge, and cross-file `imports` edge landed correctly on the first run; re-synced and
diffed with `nodum diff` — zero drift. See Success Metrics.

## Goal

Add first-class Swift support (`.swift`) — types (class/struct/enum/actor/extension/protocol),
members, complexity, `duplicateHash`, same-file `calls` edges, and Swift-only import resolution —
entirely inside `packages/core/src/parser/swift.ts`, with **zero changes** to `graph-gen.ts` or
`file-discovery.ts`. That's the roadmap's own litmus test for whether the tree-sitter parser
plugin architecture (spec 030) actually generalizes to a language family that shares nothing with
the five parsers that already exist.

## Why now

Second of four specs in the v2.7.0 "iOS: Swift + Objective-C" batch, immediately after spec 036
widened `NodeType` with `struct`/`enum`/`protocol`/`extension` specifically so this spec could
emit final-form node types on day one with no follow-up rewrite. `tree-sitter-swift.wasm` is
already vendored in the pinned `tree-sitter-wasms@^0.1.13` — no new dependency, no vendoring.

## Scope

- New `packages/core/src/parser/swift.ts`, structured identically to `java.ts` (query constants →
  node-type sets → `CallableUnit` → class → `resolveImport()` → `parse()` → `extractCalls()` →
  `extractImports()` → `computeComplexity()` → `collectNormalizedTokens()` → default export).
- `language = 'Swift'`, `extensions = ['.swift']`, `ignoredDirs = ['DerivedData', 'Pods',
  'Carthage']` (`.build`/`.swiftpm` are already skipped by `file-discovery.ts`'s existing
  dot-prefix hidden-directory rule — verified, not duplicated here).
- **Type disambiguation.** Verified empirically (loaded `tree-sitter-swift.wasm` directly and
  printed real parse trees before writing any parser code, matching this project's established
  practice): `class`/`struct`/`enum`/`actor`/`extension` all parse as **one** `class_declaration`
  grammar node — there is no dedicated `struct_declaration`/`enum_declaration`/
  `extension_declaration`. Disambiguated by scanning the declaration's direct children for the
  first keyword token (`class`/`struct`/`enum`/`actor`/`extension`) — not always `child(0)`, since
  an optional `modifiers` node (`final`, etc.) can precede it. `protocol` is a real, distinct
  `protocol_declaration` node, captured by the same combined query.
- `actor` maps to NodeType `class` — no dedicated NodeType exists for it, and `class` is the
  closest existing semantic (a reference type with members).
- **Extension node id namespacing.** `normalizeNodeId()` (spec 036, unchanged) ignores NodeType
  for non-file nodes, so a same-file `class Foo` and `extension Foo` would otherwise collide on
  id. Extensions use id-name `${typeName}+ext` and label `${typeName} (extension)` to avoid this —
  verified with a dedicated test asserting the two ids differ.
- Members: `function_declaration`/`init_declaration`(labeled `"init"`, no name field)/
  `deinit_declaration`(labeled `"deinit"`) as direct children of a `class_body`;
  `protocol_function_declaration` (no body, so `complexity`/`duplicateHash` are both correctly
  `undefined`) as direct children of a `protocol_body`.
- Complexity node set: `if_statement`, `for_statement`, `while_statement`, `guard_statement`,
  `switch_entry` (excluding a bare `default:` — matching every other parser's posture that a
  default label isn't its own decision point), `ternary_expression`, `catch_block`,
  `do_statement`, `nil_coalescing_expression`, `conjunction_expression` (`&&`),
  `disjunction_expression` (`||`). **No `binary_expression` operator-field check is needed**,
  unlike Java/JS — this grammar has dedicated node types for `&&`/`||`.
- Calls (spec 034's rule applied here): only bare-identifier calls resolve —
  `call_expression` whose first named child is `simple_identifier`. `self.foo()` (a
  `navigation_expression` first child) is not resolved, same posture as every other parser's
  qualified-call exclusion.
- Imports: `import_declaration`'s `identifier` child text (`"Foundation"`, `"UIKit.UIView"`,
  `@testable import` all share this one shape — verified). New `resolveSwiftImport()` in
  `import-resolver.ts`, modeled directly on `resolveJvmImport`'s zero-build-system-knowledge
  posture: the first dotted segment is treated as a directory-name segment and suffix-matched
  against known file paths, working for both SPM (`Sources/Foo/**`) and CocoaPods (`Pods/Foo/**`)
  layouts without parsing `Package.swift`/`.xcodeproj`/`Podfile`.
- Registered in `parser/index.ts` (2 lines: import + array entry), matching the existing 5
  parsers' pattern exactly.

## Out of scope

- **Local (nested) functions.** Swift allows a function declared inside another function's body;
  this parser doesn't extract them as their own nodes — only module-scope functions and type
  members are extracted (found via `root.namedChildren` iteration and each type's own direct
  member list, not a tree-wide query). A local function's branches are still correctly excluded
  from the *enclosing* function's complexity/hash (the same nested-boundary rule every parser here
  uses), so this is a coverage gap, not a correctness bug — verified with a dedicated test.
- **`extends`/`implements` edges** from Swift's `inheritance_specifier` (`class Foo: Bar, Baz`).
  Deferred — `graph-gen.ts`'s `parseFilesInto` adds parser-emitted edges unconditionally (only the
  *incremental* sync path filters dangling targets), and a Swift superclass is almost always
  defined in another file or the SDK, so emitting these now would produce dangling edges on every
  full sync. Same posture as spec 034 deferring cross-file `calls`.
- `Package.swift`/`.xcodeproj`/`Podfile` parsing — a deliberate reduction of the roadmap's module
  resolution bullet, matching the exact precedent `resolveJvmImport` already set for
  `pom.xml`/`build.gradle`.
- Computed properties, subscripts, operator declarations, generic constraints, property wrappers,
  `typealias`, `associatedtype`.
- Cross-language (Swift↔Objective-C) interop — spec 038 (Objective-C parser) and 039 (shared
  resolver) haven't landed yet.

## Design

### Grammar shapes verified empirically before writing the parser

```
class Foo {}        → class_declaration name:(type_identifier) body:(class_body)
struct S {}          → class_declaration name:(type_identifier) body:(class_body)      — same node type as class
enum E { case a }    → class_declaration name:(type_identifier) body:(enum_class_body)  — distinct body type
extension Foo {}     → class_declaration name:(user_type) body:(class_body)             — name field is user_type, not type_identifier
actor A {}           → class_declaration name:(type_identifier) body:(class_body)
final class F {}     → class_declaration [modifiers, then] class[TOK] type_identifier class_body
protocol P { func req() } → protocol_declaration name:(type_identifier) body:(protocol_body (protocol_function_declaration, no body:))
func g(x: Int) -> String { ... } → function_declaration name:(simple_identifier) body:(function_body)  — name field correctly returns the function name, not the return type, despite both appearing as children
class C { init() {} deinit {} } → init_declaration (name field literally the "init" token, no separate identifier) / deinit_declaration (no name field at all)
if/else-if           → nested if_statement via an `else` token + nested if_statement (no separate else_clause wrapper)
guard x else { ... } → guard_statement
for x in xs {}        → for_statement (one node type; no separate for-in vs C-style split — Swift has no C-style for)
switch { case 1: ... default: ... } → switch_statement body:(switch_body (switch_entry ...)); a `default:` entry's first named child is `default_keyword`
a && b || c            → conjunction_expression / disjunction_expression — dedicated node types, not a generic binary_expression
a ?? b                 → nil_coalescing_expression
do { try g() } catch { } → do_statement (catch_block child, field name `catch_keyword`)
foo()                  → call_expression, namedChild(0) is simple_identifier — no field names on this node
self.foo()              → call_expression, namedChild(0) is navigation_expression (self_expression + navigation_suffix)
import Foundation / import UIKit.UIView / @testable import M → import_declaration (identifier child, `.text` is the full dotted path)
```

### A real grammar quirk found and worked around, not silently ignored

A call immediately preceded by a binary operator with no parentheses — e.g. `n * fact(n - 1)` —
parses with `fact` folded into a `multiplicative_expression` that becomes the `call_expression`'s
own callee (`n * fact` parses as one unit before the `(`), making it unresolvable as a bare call
regardless of implementation correctness. Verified directly against the grammar. This does not
affect the common case (`fact(n - 1) * n`, call first) and is not something this spec's bare-call
resolution needs to special-case — documented in `swift.test.ts`'s self-recursion test, which uses
the call-first ordering deliberately and explains why.

### A real Node.js/V8 environment issue found during verification, not a code defect

Running the full workspace test suite under Vitest's default `threads` pool (worker_threads
sharing one V8 instance) reliably crashed with `Fatal process out of memory: Zone` once enough
tree-sitter grammars were JIT-compiled across that shared instance (Python/Java/JavaScript from
specs 031-033, plus Swift here as the 4th) — reproduced consistently, and reproduced even with
`--max-old-space-size` raised to 8GB, ruling out a JS heap-size problem; it's specific to
worker_threads sharing V8's internal wasm-compilation state. Fixed by switching Vitest's `pool` to
`forks` (each test file in its own OS process / V8 instance) in the shared root `vitest.config.ts`
— verified: 32 files / 306 core tests green under `forks`, reproducible crash under the default
`threads` pool. Separately, and only reproducible when invoking the built CLI directly (not
through Vitest) on this machine's Node **v25.9.0** — a very recent build, well ahead of the
`node-version: 20` this repository's CI actually runs — the same class of crash occurs *after*
`nodum sync` completes and writes fully correct output (verified: `graph.json`'s content, stats,
and edges are byte-correct before the crash trace prints; the crash is in V8's background wasm
JIT thread during process teardown, not in this spec's code). Not present under Node 20 in CI.
Documented here rather than worked around with a `process.exit()` hack in production CLI code,
since the underlying cause is outside this codebase.

## Acceptance criteria

- [x] `class`/`struct`/`enum`/`actor`/`extension`/`protocol` all extract as the correct NodeType.
- [x] An extension's id never collides with a same-file class/struct of the same name.
- [x] A method is attributed to its type (`typeId -> methodId` `defines` edge), not the file.
- [x] `init`/`deinit` are correctly labeled with no name field to read from.
- [x] A protocol requirement (no body) gets `undefined` complexity/`duplicateHash` without
      throwing.
- [x] Complexity correctly counts `if`/`guard`/`for`/`while`/`switch`-case (not `default`)/
      ternary/`&&`/`||`/`??`/`do`-`catch`, verified with the exact arithmetic spelled out in a
      test comment, matching every prior parser spec's convention.
- [x] `duplicateHash` matches for renamed-but-structurally-identical bodies across two different
      files.
- [x] `calls` edges resolve only bare-identifier calls; `self.foo()` never resolves; self-recursion
      produces a self-loop edge.
- [x] A local (nested) function is not extracted as its own node, and its branches are not folded
      into the enclosing function's complexity.
- [x] `resolveSwiftImport()` resolves a plain module import to every file under a matching
      directory segment, and a system module (`Foundation`) to nothing.
- [x] `git diff --stat` for this spec touches no line of `graph-gen.ts` or `file-discovery.ts` —
      the roadmap's litmus test, verified directly.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/swift.test.ts`, following the established 5-describe-block house
pattern plus a 6th for this spec's deliberate scope reduction: imports (5 cases — plain, dotted,
`@testable`, dedup, empty), type extraction (8 cases — one per keyword shape, an extension's
distinct label/id, an actor mapping to `class`, `final class`, a disambiguation regression guard),
member extraction (5 cases — method attribution, init/deinit labeling, protocol requirement,
extension member attribution, top-level function attribution), complexity (5 cases — baseline,
combined-construct arithmetic, bare-`default:` exclusion, `do`/`catch`, nested-function
non-double-counting), duplicateHash (2 cases), calls (4 cases — bare/qualified/unresolvable/
self-recursive), and scope reductions (1 case — local function not extracted). All 31 tests pass;
no pre-existing test elsewhere in the repo needed modification.

## Success Metrics

- Real check: a hand-built SPM-shaped fixture —
  `Sources/Networking/APIClient.swift` (a `class` with `init`, a `fetch` method combining
  `if`/`for`/`guard` and a same-file bare call to `parse`), `Sources/Networking/Parsing.swift`
  (a `struct`, `enum`, `protocol`, and `extension` of the struct), `Sources/App/main.swift`
  (`import Networking`, `import Foundation`, a top-level `run()` function) — synced with the real
  CLI. Actual `graph.json`: every node has the correct `type` (`struct`/`enum`/`protocol`/
  `extension` all present for the first time — the first real producer of spec 036's vocabulary);
  `stats.structs/enums/protocols/extensions` all `1`; `fetch`'s complexity computed as `4`
  (base 1 + if + for + guard, hand-verified); exactly one `calls` edge (`fetch -> parse`); two
  `imports` edges (`main.swift -> APIClient.swift`, `main.swift -> Parsing.swift`, both resolved
  via the `Networking` module-name directory match) and correctly **no** edge for
  `import Foundation`. Re-ran `sync` and diffed with `nodum diff`: zero drift across all 9 stats
  keys and zero added/removed/changed nodes or edges. `git diff --stat` for the full spec confirms
  `graph-gen.ts`/`file-discovery.ts` are untouched.

## Related

Depends on: 036 (`NodeType` vocabulary — this spec is its first real producer). Builds on: 030
(`TreeSitterParser`/`getQuery`), 034 (`calls` edge semantics, applied here identically). Blocks:
038 (Objective-C parser, same batch) is independent in implementation but 039 (shared Swift↔ObjC
interop) depends on both 037 and 038 landing first.
