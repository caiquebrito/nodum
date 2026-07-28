# 038 — Objective-C parser (tree-sitter)

## Status: done

Implemented and tested (32 new cases in `objc.test.ts`; full workspace suite green — 338 core,
95 cli, 60 mcp, 8 benchmarks, 501 total, up from 469 before this spec). Real check: a hand-built
fixture with a real `.h`/`.m` declaration/definition split (`Classes/Foo.h`, `Classes/Foo.m`,
`Classes/Foo+Extras.m`, `Classes/Helper.h`, `Classes/Helper.m`) synced with the real CLI — every
claimed extraction, complexity score, `calls` edge, and cross-file `imports` edge landed
correctly; re-synced and diffed with `nodum diff` — zero drift. Two real bugs were found and
fixed during this verification (not caught by unit tests alone) — see Design.

## Goal

Add Objective-C support (`.m`/`.h`) — resolving the declaration/definition split concretely, and
handling ObjC's complete lack of bare-call syntax — entirely inside
`packages/core/src/parser/objc.ts`, with zero changes to `graph-gen.ts`/`file-discovery.ts`
(confirmed via `git diff --stat`, matching spec 037's same litmus-test result).

## Why now

Third of four specs in the v2.7.0 batch, independent of 037 (Swift) in implementation — both
build on 036's `NodeType` vocabulary and follow the same tree-sitter parser template, but neither
depends on the other's code. `tree-sitter-objc.wasm` is already vendored in the pinned
`tree-sitter-wasms@^0.1.13`.

## Scope

- New `packages/core/src/parser/objc.ts`, same structure as `java.ts`/`swift.ts`.
- `language = 'Objective-C'`, `extensions = ['.m', '.h']` (`.h` ownership: claimed here since no
  C/C++ parser exists in this registry yet — `tree-sitter-c.wasm` is already vendored in
  `tree-sitter-wasms`, so this is a real, accepted, time-limited collision risk for whenever a
  C/C++ parser is eventually added, not solved by this spec), `ignoredDirs = ['DerivedData',
  'Pods', 'Carthage']`.
- **Declaration/definition split (verified against real grammar shapes, then against real code in
  the fixture):** a type node is emitted only from `class_implementation` (→ `class`, or →
  `extension` when a `category:` field is present) and `protocol_declaration` (→ `protocol`).
  `class_interface` (a `.h` `@interface`) contributes **imports only** — no type node. Verified
  directly: a fixture with both `Foo.h`'s `@interface Foo : NSObject` and `Foo.m`'s
  `@implementation Foo` produces exactly **one** `Foo` node, on `Foo.m`.
- **Name extraction is purely positional** (verified empirically — `class_implementation`,
  `class_interface`, and `protocol_declaration` all have **no `name:` field at all**): the type
  name is simply `defNode.namedChild(0)`, always an `identifier`, always first, since ObjC syntax
  puts the name immediately after the `@interface`/`@implementation`/`@protocol` keyword.
- **Category detection via the verified `category:` field**, present on both `class_interface`
  and `class_implementation` for `@interface Foo (Extras)`/`@implementation Foo (Extras)`.
  Extension id namespacing mirrors Swift's (spec 037): `${typeName}+${categoryName}`, avoiding a
  same-file `@implementation Foo`/`@implementation Foo (Extras)` id collision.
- **Method extraction requires a two-level walk and is entirely positional, not field-based**
  (verified — `class_implementation` has no `body:` field at all): each method is wrapped in its
  own `implementation_definition` (one per method, not a single container for all of them), whose
  single child (when it's a real method, not a mis-parsed construct — see Design) is
  `method_definition`. `protocol_declaration`'s `method_declaration` members are direct children,
  no wrapper. **`method_definition`/`method_declaration` also have no `body:` field** — the body,
  when present, is simply the last named child, a `compound_statement`.
- **Full-selector naming**: `doThing:withOther:`, assembled from a `method_definition`'s
  `identifier` children, colon-joined only when a `method_parameter` sibling is present (bare
  `bar` otherwise). Matching on the call side (`message_expression`) needed **different, purely
  positional** logic — see Design's bug-fix writeup below.
- **Calls (documented divergence from spec 034's rule, per the approved plan's Decision E):**
  `[self x]`/`[super x]` message sends resolve — ObjC has no bare-call syntax at all, so applying
  the other four parsers' "unqualified calls only" rule verbatim would make this parser's `calls`
  support provably inert. A `self`/`super` receiver inside `@implementation` has a
  statically-known type (the enclosing class), making it *more* reliable to resolve than the
  bare-identifier lookup the other parsers already accept. Bare C function calls
  (`call_expression` with an `identifier` function) also resolve. Any other receiver (`[obj foo]`)
  does not.
- **C functions**, including ones declared as a direct child of an `@implementation` block (a real
  idiom — a `static` C helper colocated with the class it supports) — see Design's second bug
  writeup.
- Imports: `preproc_include` with a quoted `string_literal` path → filename-suffix match;
  `system_lib_string` (angle-bracket) → external, resolves to `[]`; `module_import`
  (`@import M;`) → module-name directory match, same shape as Swift's. New `resolveObjcImport()`
  in `import-resolver.ts`.
- Registered in `parser/index.ts` (2 lines), matching every prior parser's pattern.

## Out of scope

- `extends`/`implements` edges from `superclass:`/`protocol_reference_list` — deferred, same
  dangling-edge reasoning as spec 037. Additionally and independently unreliable here: verified
  `@interface Foo : NSObject <Drawable>` parses `<Drawable>` as `parameterized_arguments`, a
  generics-parsing ambiguity, not a `protocol_reference_list`.
- `@property` extraction — verified the grammar mis-parses `@property (nonatomic) int x;` as an
  `ERROR` node followed by a plain `declaration` (not a dedicated property node), confirming this
  is a genuinely noisy shape in this grammar build, not worth extracting. The parser tolerates it
  without crashing (a stray `implementation_definition` wrapping a `declaration` instead of a
  `method_definition` is simply skipped) — verified with a dedicated test.
- Blocks, `@synthesize`, preprocessor-conditional code paths, ARC annotations.
- Swift↔Objective-C symbol-level or file-level interop — spec 039.

## Design

### Grammar shapes verified empirically before writing the parser

```
#import <Foundation/Foundation.h> → preproc_include path:(system_lib_string)   — external, not extracted
#import "Helper.h" / #include "Other.h" → preproc_include path:(string_literal (string_content)) — same shape for both directives
@import MyModule; → module_import path:(identifier)
@interface Foo : NSObject → class_interface [no name: field] superclass:(identifier) — name is namedChild(0)
@interface Foo : NSObject <Drawable> → same, PLUS parameterized_arguments("<Drawable>") — NOT protocol_reference_list (generics-parsing ambiguity)
@implementation Foo → class_implementation [no name: field, no body: field] — name is namedChild(0)
@interface Foo (Extras) / @implementation Foo (Extras) → category:(identifier) field present on both
@protocol Drawable { - (void)draw; } → protocol_declaration [no name: field] namedChild(0)=identifier, method_declaration members direct children, no body: field, no wrapper
@implementation Foo { - (void)bar {} - (void)baz {} } → each method its own implementation_definition wrapper (not one wrapping both) → method_definition [no body: field — body is the last named child, compound_statement]
- (void)doThing:(int)a withOther:(int)b → method_definition namedChildren: [method_type, identifier"doThing", method_parameter, identifier"withOther", method_parameter, compound_statement]
[self baz] / [super baz] / [obj baz] → message_expression, receiver is namedChild(0), always a plain `identifier` (self/super are NOT a dedicated node type in this grammar, unlike Swift's self_expression)
[obj doThing:1] → message_expression namedChildren: [identifier"obj", identifier"doThing", number_literal"1"] — selector part and argument strictly alternate after the receiver
helper() → call_expression function:(identifier)
void helper() {} → function_definition declarator:(function_declarator declarator:(identifier)) body:(compound_statement)
if/for/while/do-while → if_statement/for_statement/while_statement/do_statement
switch { case 1: ... default: ... } → switch_statement body:(compound_statement (case_statement ...)); a default entry's child(0).type === 'default' [unnamed token] vs 'case' for a real case
a ? 1 : 2 → conditional_expression
a && b / a || b → binary_expression, operator field populated ("&&"/"||") — same shape as Java, unlike Swift's dedicated node types
@try { } @catch (NSException *e) { } → try_statement catch_clause
@property (nonatomic) int x; → ERROR node + a plain `declaration` — genuinely broken in this grammar build, confirmed
```

### Bug 1, found via real end-to-end verification, not unit tests: `callSelector`'s type-based heuristic was wrong

The first implementation detected a call site's argument count by counting non-`identifier`
children (`restChildren.length > identifiers.length`), reasoning by analogy from the
`method_parameter`-based check that correctly detects a *definition's* argument count. This broke
silently and specifically whenever a call's argument was itself a bare identifier (a variable
reference, e.g. `[self baz:y]`) — the argument `y` is also type `identifier`, so the count-based
heuristic couldn't distinguish it from the selector part `baz`, producing the wrong (colon-less)
selector `"baz"` instead of `"baz:"`. Every unit test up to that point used literal arguments
(`[obj doThing:1]`), which happened to never exercise this path — the bug was invisible until the
real fixture's `return [self baz:y];` exposed it. **Fixed by switching to purely positional
logic**: ObjC's grammar strictly alternates selector-part-identifier, argument,
selector-part-identifier, argument, ... after the receiver, so every even index (`0, 2, 4, ...`)
in the post-receiver children is a selector segment regardless of what type its following argument
happens to be. A regression test (`[self baz:y]` specifically, with an identifier argument) was
added alongside the fix.

### Bug 2, found the same way: a `static` C helper inside `@implementation` wasn't extracted at all

The first implementation searched for top-level C functions via `root.namedChildren` only
(mirroring Swift's same-shaped scan for top-level functions). This missed a real, common ObjC
idiom: a `static` C helper function declared as a **direct child of an `@implementation` block**
(colocated with the class it privately supports) — verified this is a real `function_definition`
node, sibling to the block's `implementation_definition` method wrappers, not wrapped in one
itself, and therefore invisible to a `root.namedChildren`-only scan. **Fixed by switching to
`root.descendantsOfType('function_definition')`**, which finds it at any depth — safe because
`function_definition` never nests inside another `function_definition`/`method_definition` in
C/ObjC, so there's no double-extraction risk. A regression test was added.

Both bugs were caught by the mandated real-CLI-sync verification step, not by the 30 unit tests
that existed before the fixture check — a concrete demonstration of why this project's spec
process requires that step beyond unit coverage.

## Acceptance criteria

- [x] `@implementation` produces a `class` node; a bare `@interface` produces none — verified on
      real code with both present for the same type.
- [x] A category `@implementation` produces an `extension` node with a distinguishing id/label; a
      category `@interface` produces none.
- [x] A method is attributed to its type, not the file; full multi-part selectors are correctly
      assembled on both the definition and call sides.
- [x] A protocol method (no body) gets `undefined` complexity/`duplicateHash` without throwing.
- [x] A mis-parsed `@property` does not crash the parser and is not extracted as a method.
- [x] Complexity correctly counts `if`/`for`/`while`/`do`-`while`/`switch`-case (not `default`)/
      ternary/`&&`/`||`/`@try`-`@catch`, hand-verified arithmetic in test comments.
- [x] `calls` edges resolve `self`/`super` message sends and bare C calls; any other receiver does
      not resolve; a call with an identifier argument resolves correctly (regression test for Bug
      1); self-recursion produces a self-loop edge.
- [x] A `static` C helper nested inside `@implementation` is extracted as a `function` node
      attributed to the file (regression test for Bug 2).
- [x] `git diff --stat` touches no line of `graph-gen.ts`/`file-discovery.ts`.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/objc.test.ts`, the established 5-block house pattern plus the
declaration/definition split as its own block: imports (6 cases), declaration/definition split
(6 cases — including the single most important test in the file, that a bare `@interface`
produces no class node), member extraction (7 cases, including the two regression cases for Bugs
1 and 2), complexity (4 cases), duplicateHash (2 cases), calls (7 cases). 32 tests total, all
passing; no pre-existing test elsewhere needed modification.

## Success Metrics

- Real check: `Classes/Helper.h`/`.m` (an interface + implementation pair), `Classes/Foo.h`
  (imports, an `@interface`, a nested `@protocol Drawable`), `Classes/Foo.m` (`@implementation`
  with a `static` C helper, a `bar:` method combining `if`/`for`, a same-file bare call to
  `helper`, and a `[self baz:y]` self-message-send), `Classes/Foo+Extras.m` (a category) — synced
  with the real CLI. Actual `graph.json`: exactly **one** `Foo` node (type `class`, on `Foo.m` —
  not two); `Drawable` node type `protocol`; `Foo (Extras)` node type `extension`; `helper`
  extracted as a `function` node; `bar:`'s complexity correctly `3` (base 1 + if + for); **two**
  `calls` edges (`bar: -> helper`, `bar: -> baz:`) — both bugs above fixed and verified on this
  exact real-code path; correct `imports` edges, none from the angle-bracket Foundation import.
  Re-ran `sync` and diffed with `nodum diff`: zero drift across all 9 stats keys and zero
  added/removed/changed nodes or edges.

## Related

Depends on: 036 (`NodeType` vocabulary — this spec's second real producer, alongside 037).
Independent of 037 (Swift parser) in implementation, though both belong to the same v2.7.0 batch
and follow the same tree-sitter template. Blocks 039 (shared Swift↔ObjC file-level interop), which
needs both parsers to exist to be verifiable.
