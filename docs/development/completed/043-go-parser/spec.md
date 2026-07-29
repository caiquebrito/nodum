# 043 — Go parser (tree-sitter)

## Status: done

Implemented and tested (33 new cases across `go.test.ts` and `import-resolver.test.ts`; full
workspace suite green — 385 core, 95 cli, 77 mcp, 8 benchmarks, 565 total, up from 532 before this
spec — every pre-existing assertion passes unmodified except one, updated intentionally: see Test
plan). Real check: hand-built a Go module fixture (a struct/interface/methods split across two
files in one package, a `main.go` importing both a stdlib and the local package), synced it with
the real CLI, and verified every count, complexity score, method attribution, and import edge by
hand against `graph.json` — then re-synced and confirmed zero drift via `nodum diff`. First of
three specs in the v2.9.0 batch.

## Goal

Add Go as a first-class parsed language via `web-tree-sitter`, following the exact plugin pattern
established for Python/Java/JavaScript/Swift/Objective-C (specs 031–038). Lowest-risk spec in this
batch — fully independent of the other two, ships first.

## Why now

Research during this batch's scoping confirmed Go is genuinely cheap to add, unlike the other two
originally-considered roadmap bullets (KMP, Dart/Flutter) which turned out to need real
build-file-reading machinery this codebase doesn't have yet: `tree-sitter-go.wasm` is the smallest
grammar in the already-pinned `tree-sitter-wasms` bundle (235 KB — half of Python's), the parser
shape mirrors `python.ts` almost exactly, and import resolution reuses the existing
`resolveSwiftObjcImport`-style directory-suffix pattern with zero new dependencies or build-system
parsing (`go.mod` is never read).

## Scope

- New `packages/core/src/parser/go.ts` (`GoParser extends TreeSitterParser`,
  `grammarFile = 'tree-sitter-go.wasm'`, `ignoredDirs = ['vendor']`). Three query passes:
  - **Types** — `struct_type`/`interface_type` become `'struct'`/`'interface'` nodes (both
    `NodeType` members already existed since spec 036); any other `type:` shape (`type Celsius
    float64`, aliases) is deliberately skipped, not mis-tagged — verified with a dedicated test.
  - **Methods** — Go methods are *siblings* of their type, not nested in its body, so attribution
    goes through a `receiverTypeName()` helper parsing `(s *Server)`/`(s Server)`/generic receiver
    shapes (`(c *Cache[K, V])` → `"Cache"`). A method whose receiver type isn't declared in *this*
    file (common — Go often splits a type and its methods across files in one package) attaches to
    the file node instead of being dropped.
  - **Functions** — top-level only; no exclusion-set bookkeeping needed since
    `method_declaration`/`function_declaration` are distinct grammar node types (unlike Python's
    method/function overlap, which needs one).
- `COMPLEXITY_NODE_TYPES`: `if_statement`, `for_statement` (Go's only loop construct),
  `expression_case`/`type_case`/`communication_case` (switch/type-switch/select — `default_case`
  excluded). `&&`/`||` via `binary_expression`'s `operator:` field, same pattern as `java.ts`.
  `else if` nests as a plain child `if_statement` in this grammar — no special-casing needed at the
  cyclomatic level (each `if_statement` encountered costs +1 regardless of nesting; that changes
  for spec 045's cognitive complexity, which does need to special-case it — noted there).
- Traversal boundary (complexity, `duplicateHash`, `calls`): stops at
  `function_declaration`/`method_declaration`, but **descends into `func_literal`** (an anonymous
  closure) since it isn't separately extracted as its own node — matching TypeScript's arrow-
  function precedent.
- New `resolveGoImport` in `import-resolver.ts`: a specifier (`"github.com/foo/bar"`,
  `"myapp/internal/svc"`) names a whole **package**, resolving to every `.go` file in the matching
  directory (unlike every other resolver here, which resolves to at most one file per specifier).
  Tries progressively shorter suffixes of the path, directory-suffix-matching against
  `knownFilesByPath` — same zero-build-system-knowledge posture `resolveJvmImport` takes for
  `pom.xml`/`build.gradle` (no `go.mod` parsing). A stdlib import (`"fmt"`, `"net/http"`) simply
  matches nothing — no allowlist needed.
- One-line registration in `parser/index.ts`. **Zero changes** to `graph-gen.ts` or
  `file-discovery.ts` — confirmed via `git diff --stat` showing an empty diff for both files.

## Out of scope

- `go.mod`/`go.sum` parsing — import resolution is directory-suffix-based only, same reduction
  every other resolver in this codebase already makes.
- Generic type *parameters* on structs/interfaces (`type Cache[K, V] struct{}`) are not specially
  modeled — the struct/interface node is extracted the same as a non-generic one; only the receiver
  side (matching a generic method back to its base type name) needed explicit handling.
- Embedded struct fields / interface embedding are not turned into `extends`/`implements` edges —
  no other tree-sitter parser in this codebase does this for its own language's equivalent either
  (Java's `implements`/`extends` keywords aren't wired to those `RelationType` values yet); left for
  a future spec if ever prioritized, consistently with existing precedent.

## Design

### Empirical verification before writing parser code

Per this project's established practice (spec 037's approach for Swift), all five query strings and
every node-shape assumption below were verified against the real shipped `tree-sitter-go.wasm` via
disposable scratch scripts before being written into `go.ts`, not assumed from generic tree-sitter-Go
documentation:
- The exact three query strings (types/methods/functions) all compile and match correctly.
- A pointer receiver's inner type name is reached via `pointer_type`'s own first named child, which
  is either `type_identifier` (plain) or `generic_type` (whose own first named child is the base
  name) — verified against `(s *Server)` and `(c *Cache[K, V])` receivers.
- `else if` really does nest as a plain child `if_statement`, not a dedicated `elif`-style node —
  confirmed no special handling is needed for cyclomatic complexity here (cognitive complexity, spec
  045, is a different story).
- `func_literal` is confirmed a distinct node type from `function_declaration`/`method_declaration`,
  never itself carrying a `name:` field — so it's correctly never captured by the function/method
  queries, and safe to explicitly descend into for complexity/calls/duplicateHash purposes.

## Acceptance criteria

- [x] `.go` files are discovered and parsed with zero changes to `file-discovery.ts` (verified via
      `git diff --stat`).
- [x] Structs and interfaces produce `'struct'`/`'interface'` nodes; other `type` declarations are
      skipped, not mis-tagged.
- [x] A method is attributed to its receiver's struct/interface node when declared in the same file,
      and to the file node when the receiver type lives in a different file of the same package.
- [x] Cyclomatic complexity counts `if`/`for`/`&&`/`||`/non-default switch-type-switch-select cases;
      `func_literal` bodies roll into the enclosing function/method, not counted separately.
- [x] Same-file bare-identifier `calls` edges resolve; qualified `pkg.Fn()` calls do not.
- [x] `resolveGoImport` resolves a local package import to every `.go` file in its directory
      (both a bare local path and a full module-host-prefixed path), and returns nothing for a
      stdlib import.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`go.test.ts` (29 cases): imports (single/grouped/aliased/raw-string/dedupe/none), types
(struct/interface/skipped-alias/multiple-in-one-block), methods (value receiver, pointer receiver,
generic receiver, cross-file receiver, not double-extracted as a function), functions
(top-level, `func_literal` not separately extracted), complexity (baseline, if/for/&&/||, else-if,
switch-with-default-excluded, descending into `func_literal`, no double-count across top-level
functions), duplicateHash, calls (bare, qualified-unresolved, recursive, through a `func_literal`).
`import-resolver.test.ts` (+4 cases): local package resolution, full-module-path resolution, stdlib
returns empty, no-match returns empty.

One pre-existing test was intentionally updated, not left broken: `file-discovery.test.ts`'s "does
not discover .go/.rs/.rb files — no parser supports them" asserted `.go` was unsupported, which
this spec makes false by design — updated to drop the `.go` fixture file and cover only the
still-unsupported `.rs`/`.rb`, with a comment noting why.

## Success Metrics

- Real check: hand-built a 4-file Go module (`go.mod`; `internal/svc/server.go` with a struct, an
  interface, a pointer-receiver method containing `if`/`for`/`else if`, and a same-file helper
  call; `internal/svc/store.go` with a second pointer-receiver method on the *same* struct declared
  in the *other* file; `cmd/app/main.go` importing both `"fmt"` and the local `myapp/internal/svc`
  package) synced via the real CLI. Verified by hand against `graph.json`: `stats.structs=1`,
  `stats.interfaces=1`; `Start`'s complexity is exactly 4 (base 1 + `if` + `for` + `else if`,
  hand-counted); exactly one `calls` edge (`Start → helper`); `Start` attached to the `Server`
  struct's node (declared in the same file); `Save` attached to the *file* node (its receiver's
  struct is declared in a different file); exactly 2 `imports` edges from `main.go` (to both files
  of `internal/svc`) and zero for `"fmt"`. Re-synced and diffed via `nodum diff` — zero drift
  (identical stats, zero added/removed/changed nodes and edges). `nodum complexity` and `nodum
  suggest-refactoring` both ran cleanly against the fixture with no errors.
- `git diff --stat` against `graph-gen.ts`/`file-discovery.ts` — empty, confirming the parser
  plugin architecture (spec 030) generalizes to Go with zero changes outside the parser itself,
  same litmus test spec 037 applied for Swift.

## Related

First of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive
complexity). Fully independent of specs 044/045 — no shared code with either. KMP (`expect`/
`actual` edges, source-set awareness) and Dart/Flutter support were both deferred out of this batch
after research showed each needs real new machinery (a module/source-set model and a first
build-file reader, respectively) — see the v2.9.0 plan and ROADMAP.md for the full reasoning.
