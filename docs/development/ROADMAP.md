# Nodum Roadmap

**Last updated:** 2026-07-29 · **Current release:** v2.13.0 (all four packages, lockstep) · **Specs shipped:** 58 (`docs/development/completed/`)

This roadmap tracks real shipped state, not aspiration. Every "✅ Shipped" release below has a
matching set of specs under [`docs/development/completed/`](./completed/), each with its own
real end-to-end verification against synced projects — not just unit tests.

One numbering note: **the roadmap label and the real npm version are not always the same
number.** Changesets bumps the lockstep `fixed` group by exactly one minor version per release,
regardless of how big that release's roadmap milestone is. So "the v2.2.0 batch" and "the v2.3.0
batch" below shipped as real npm **v2.5.0** and **v2.6.0** — the labels here describe the roadmap
milestone; the version badge at the top of the README is the actual truth for what's installed.

---

## ✅ Shipped

### v2.0.0 — Claude excellence
Multi-turn conversation caching, semantic search embeddings, hierarchical clustering,
`expand_cluster` MCP tool. TypeScript-only monorepo, 5 language parsers, MCP integration, 3D
viewer, benchmark suite.

### v2.1.0 — Speed & scale (20 specs, `000`–`020`)
Incremental sync, `nodum watch`, `nodum init`/`config`/`export`/`diff`. Real cross-file `imports`
edges for TS/JS/Kotlin/Java (previously zero cross-file edges existed at all). Five new analyzers
— `cycles`, `dead-code`, `architecture`, `complexity`, `duplicates` — and five new MCP tools built
on top of them (`trace_impact`, `find_bottlenecks`, `explain_architecture`, `find_similar_code`,
`suggest_refactoring`).

### Truth & measurement batch — shipped as real npm v2.5.0 (specs `021`–`029`)
The gate release: nothing here changed a feature, everything made an existing claim either real
or removed.
- Real token accounting — a real tokenizer counts every context payload `buildSmartContext()`
  emits; the hardcoded percentage strings that used to be injected straight into Claude's context
  are gone, replaced by a per-response measured number.
- Fixed the unbounded-context bug — `expandContext()` used to expand every seed node to *all*
  1-hop neighbors, uncapped; a hub file with hundreds of dependents could blow the context open.
  Now bounded.
- Made the benchmark harness trustworthy: moved into the workspaces array, gated in CI
  (`.github/workflows/benchmark-accuracy.yml`), a precision term added to the accuracy scorer.
- Lockstep versioning via Changesets' `fixed` group (`.changeset/config.json`) — all four
  packages release together under one real, taggable version, closing the gap between the
  roadmap label and what npm actually shows.
- Per-session efficiency logging to `~/.nodum/<project>/logs/metrics.jsonl`.

### Tree-sitter foundation + calls edges — shipped as real npm v2.6.0 (specs `030`–`035`)
"A new language becomes a grammar file and a query file, not a new parser."
- Python, Java, and JavaScript migrated from line-regex to `web-tree-sitter`
  (`^0.25.10`, pinned — 0.26.x breaks ABI compatibility with `tree-sitter-wasms`' grammars).
  TypeScript stays on the compiler API — it remains the one parser with real resolved-type data.
  **Kotlin stays on regex this batch** — its tree-sitter grammar (`fwcd/tree-sitter-kotlin`)
  benchmarks at ~61% structural fidelity against the real JetBrains compiler; not worth forcing
  in, deferred to its own future spec.
- Python gets real cross-file imports for the first time (`python.ts`'s import loop used to be an
  empty `while` — every Python project silently produced zero cross-file edges), real complexity,
  real structural duplicate hashing.
- Java gets real method/constructor extraction (the old regex missed constructors entirely and
  could mis-parse `} else if (...)` as a method named `if`).
- JavaScript gets `line` numbers for the first time and real class-member extraction (previously
  zero — a JS class node had nothing inside it).
- New `'calls'` relation on same-file function/method calls, resolved via a flat name lookup —
  bare-identifier calls only (`foo()`, not `this.foo()`/`obj.foo()` — no reliable receiver-type
  information without a real type checker). Lays the groundwork spec 012 explicitly deferred
  symbol-level dead-code analysis on; doesn't wire that analyzer up itself.
- Consolidated the `Graph`/`Node`/`Edge` types — previously hand-redeclared in five places and
  already drifted (`packages/mcp/src/handlers.ts` used `type: string` instead of the real
  `NodeType`, papered over with a cast). Now a single source of truth in `core/src/types.ts`.

### iOS: Swift + Objective-C — shipped as real npm v2.7.0 (specs `036`–`039`)
Proved the tree-sitter parser plugin architecture (v2.6.0) generalizes to a language family that
shares nothing with the five parsers that existed before it. **Verified: zero changes to
`graph-gen.ts` or `file-discovery.ts` across all four specs** — the release's own litmus test.
- `NodeType` widened to 9 types (`struct`/`enum`/`protocol`/`extension` new, spec 036) — shipped
  ahead of either parser so neither re-types a node on a follow-up release. Also fixed a
  pre-existing gap where `interface`/`method` nodes silently rendered grey in the 3D viewer.
- Full Swift parser (spec 037) — `class`/`struct`/`enum`/`actor`/`extension` all fold into one
  grammar node in this tree-sitter grammar, disambiguated by keyword; `protocol` is a distinct
  node. Real complexity, `duplicateHash`, same-file `calls` edges, module import resolution.
  Along the way, found and fixed a real Vitest/V8 issue: the default `threads` pool reliably
  OOM-crashed once enough tree-sitter grammars were JIT-compiled across a shared V8 instance —
  fixed by switching the workspace to `pool: 'forks'`.
- Full Objective-C parser (spec 038) — a type node comes only from `@implementation`/`@protocol`,
  never a bare `@interface`, avoiding the split-node problem a header/implementation pair would
  otherwise cause. `calls` edges resolve `self`/`super` message sends (a deliberate divergence
  from every other parser's bare-call-only rule — Objective-C has no bare method-call syntax at
  all). Two real bugs found and fixed during real-CLI verification, not caught by unit tests
  alone: a call-selector heuristic that broke on identifier arguments, and a missed `static` C
  helper nested inside `@implementation`.
- Unified Swift/Objective-C import resolution (spec 039) — a Swift `import Foo` resolves to
  `Foo`'s `.m`/`.h` files and vice versa; verified on a real mixed fixture that a bridging header,
  an ObjC class, and an importing Swift file render as one connected graph component, not two
  disconnected islands. **File-level `imports` edges only** — `@objc`-annotation symbol-level
  `calls` edges would need changes to `graph-gen.ts` and are deferred to a future spec, same
  posture as same-file `calls` deferring cross-file resolution.
- Module resolution via directory-suffix matching (mirroring how JVM dotted-FQN imports already
  resolve), **not** `Package.swift`/`.xcodeproj`/`Podfile` parsing — a deliberate reduction
  matching the precedent `resolveJvmImport` already set for `pom.xml`/`build.gradle`.

### Adaptive context budgeting — shipped as real npm v2.8.0 (specs `040`–`042`)
"Stop guessing at output size; spend a token budget deliberately." Two of the four bullets this
milestone originally planned turned out more complicated than their one-line roadmap description
implied — both scoped down deliberately rather than shipped half-right; see each spec's own Design
section for the full reasoning.
- In-process graph cache (spec 040) — `handlers.ts` used to re-parse `graph.json` from disk on
  every single MCP tool call; some real projects' graphs are tens of MB. New `GraphCache` mirrors
  `conversation-cache.ts`'s shape (TTL-based, per-project `Map`, `clearProject()` invalidation),
  wired into all 11 read-path handlers, invalidated right after `sync_project` writes a fresh
  graph.
- Token-budgeted `search_graph` (spec 041) — accepts an optional `token_budget`, filling context
  greedily by relevance until the budget is spent instead of the old fixed `.slice(0, N)`
  truncation scattered through `smart-context.ts`. Found and fixed a real 25%-overshoot bug via
  real-CLI verification (a 300-token budget was producing 375 actual tokens) before landing on
  287/300 and 570/600 — the kind of bug only real end-to-end checking catches. Also fixed a
  previously dead `type_filter` parameter that was accepted but silently ignored since before this
  spec.
- Parallel file discovery, parser safety fix, sync guardrails (spec 042) — `discoverFiles`/
  `discoverChangedFiles` now read/hash files with bounded concurrency instead of sequentially, a
  real wall-clock win verified byte-identical (including cluster assignment) against a frozen
  real-project snapshot. Fixed a latent tree-sitter safety issue: `TreeSitterParser` no longer
  memoizes one shared `TSParser` per instance forever — each parse gets its own, bound to the
  already-shared, genuinely-immutable `Language` — and `tree.delete()` now runs across all 5
  tree-sitter-backed languages to stop leaking WASM memory. New `.nodumrc.json` guardrails
  (`maxFileSizeBytes`, `maxFilesWarning`) warn rather than silently truncate.
- **Deliberately descoped from the original plan:** real modularity clustering (Louvain/Leiden)
  over `calls`+`imports` together, and `worker_threads`-based parse-time parallelism. Both are
  real prerequisites-blocked, not preferences — `calls` edges are same-file-only and `imports`
  edges are file-only, so they share no endpoints and a naive Louvain pass would roughly
  rediscover today's heuristic at far higher cost; real cross-file `calls` resolution has to exist
  first. Parsing itself is synchronous, CPU-bound WASM work — wrapping it in `Promise.all` doesn't
  parallelize it, it just reorders microtasks on the same thread with zero wall-clock benefit; real
  throughput needs actual OS threads, deferred to its own future spec once justified by profiling.

### Go, Kotlin tree-sitter migration, cognitive complexity — shipped as real npm v2.9.0 (specs `043`–`045`)
Originally planned as "Cross-platform mobile: KMP, Flutter, Go." Research at the start of this
batch found two of that plan's four bullets significantly more complicated than their one-line
descriptions implied — both deferred out of the batch entirely rather than shipped half-right; see
below and each spec's own Design section for the full reasoning.
- Go parser (spec 043) — first-class Go support via tree-sitter: structs, interfaces, functions,
  methods (attributed to their receiver's struct, including across files when a type and its
  method live in different files of the same package), real complexity, `duplicateHash`, same-file
  `calls` edges, package-path import resolution. **Zero changes to `graph-gen.ts`/
  `file-discovery.ts`** — the parser plugin architecture (spec 030) generalizes cleanly yet again.
- Kotlin tree-sitter migration (spec 044) — Kotlin finally off line-regex extraction (deferred at
  v2.6.0 pending a better grammar, revisited and found workable via careful empirical probing of
  the real shipped grammar, not reliant on a newer upstream release). Gains real `method` nodes
  (previously flat, colliding file-attached `function` nodes whenever two classes shared a method
  name), same-file `calls` edges, a dedicated `enum` node type, and fixes a real bug found during
  this spec's own real-CLI verification: extension functions (`fun String.slugify()`) were silently
  never extracted at all by the old regex parser. `resolveJvmImport`/import specifier format
  unchanged — every pre-existing import test passes unmodified, this migration's explicit contract.
- Cognitive complexity (spec 045) — a second, nesting-depth-aware complexity metric (SonarSource-
  inspired) alongside the existing cyclomatic one, across all 8 languages this project now parses.
  `nodum complexity --cognitive`. Verified via a real polyglot fixture (the same deliberately-shaped
  function written in all 8 languages) producing identical `(cyclomatic, cognitive)` pairs across
  every language — the real check that caught a genuine bug unit tests alone had missed: a
  boolean-operator-chain-collapsing heuristic assumed universally left-associative grammar nesting,
  overcounting on Swift's right-associative grammar until fixed to check the parent node instead
  (associativity-agnostic).
- **Deliberately deferred, not shipped half-right:** KMP support (`expect`/`actual` edges,
  source-set awareness) turned out to need a real module/source-set model (parsing
  `settings.gradle`, a `sourceSet` field on nodes) plus a brand-new symbol-to-symbol cross-file
  resolution pass — structurally unlike every existing `imports`-edge mechanism (file-to-file,
  specifier-driven) and incompatible with the current incremental-sync edge model (edges carried
  over keyed by source file only). The v2.7.0 roadmap's claim that this "needs the Gradle-aware
  module roots the iOS release builds" was itself wrong — v2.7.0 explicitly declined
  Gradle/`Package.swift` parsing in favor of directory-suffix matching. Realistically 2–3 specs on
  its own; tracked as its own future initiative, not restated here as one release away.
  Dart/Flutter support needs a 3-way import scheme (`package:`/`dart:`/relative) and would be this
  codebase's *first* build-file reader (`pubspec.yaml` resolution — no YAML dependency exists yet,
  and `Parser.resolveImport()`'s signature is currently project-config-blind) — materially harder
  than Go was, deferred to its own future release rather than bundled in alongside it.
  Cross-language duplication detection cannot be built as an extension of today's exact-hash
  `duplicateHash` at all — different languages produce disjoint token vocabularies by construction.
  It needs same-language *near*-duplicate/fuzzy detection first (itself never built — spec 015
  explicitly deferred it), then a separate cross-language similarity layer on top: 2–3 specs
  stacked on an unbuilt prerequisite, dropped from this batch rather than restated as imminent.

### Housekeeping, server hardening, near-duplicate detection, Kotlin source-sets — shipped as real npm v2.10.0 (specs `046`–`049`)
A smaller batch than v2.9.0, deliberately: this closed out the same-language near-duplicate
prerequisite named below, fixed a real security bug and a real stack-detection bug found during
scoping (not hypothetical issues), and did a bit of repo cleanup — no new language, no risky
research bets.
- Housekeeping (spec 046) — deleted the stale, diverged root-level `/viewer/` fork and the
  abandoned `claude skills/sync-rag/` v0 artifact; reconciled the cosmetic root `package.json`
  version.
- `packages/server` security hardening (spec 047) — a real path-traversal bug, confirmed by
  reproducing it live against the unpatched server before writing any fix: a URL-encoded `..%2F`
  project name could read `graph.json` files outside `~/.nodum`. Also fixed an unauthenticated
  `0.0.0.0` bind — `nodum serve` now binds `127.0.0.1` by default (`NODUM_HOST` to opt into wider
  binding, with a printed warning). First real test suite `packages/server` has ever had.
- Near-duplicate code detection (spec 048) — `find_similar_code`/`nodum similar-code` is now
  genuinely fuzzy via a MinHash-style similarity signature over the same normalized token stream
  every parser already produced for `duplicateHash` (no new dependency — hand-rolled FNV-1a
  measured ~4.4x faster than `crypto.createHash` for this workload). The default threshold (0.65)
  was calibrated against real data: a ~370-pair sweep across nodum's own codebase (zero false
  positives observed down to 0.5) plus a polyglot 8-language fixture that determined the actual
  number (a naive 0.7 would have missed the near-duplicate case in the lowest-scoring language,
  TypeScript at 0.688). Scoped to single-node fuzzy lookup only — see Housekeeping section below
  for what stays deferred.
- Kotlin module/source-set labeling (spec 049) — fixed a real, confirmed stack-detection gap:
  `readBuildGradle`/`readSettingsGradle` never read the `.gradle.kts`/`settings.gradle.kts` (Kotlin
  DSL) variants. Four real Kotlin/Android projects already synced on this machine all showed
  completely empty `languages`/`frameworks` before this fix — not a contrived example. New
  path-convention `Node.sourceSet` field (`commonMain`/`androidMain`/`test`/...) — the small,
  standalone-value slice of the still-deferred KMP initiative (see below), not that initiative
  itself.

### MCP protocol fix, Kotlin module labeling, near-duplicate grouping — shipped as real npm v2.11.0 (specs `050`–`052`)
Batch-scoping research for this release found every one of its three candidates smaller or more
tractable than the prior roadmap/prior specs had assumed — the opposite of v2.9.0's research
(which found KMP/Dart harder than assumed). All three specs' mandatory real end-to-end verification
caught genuine bugs before they shipped, not just confirmed correctness.
- MCP `isError` protocol fix (spec 050) — every one of 17 handler error-return sites returned a
  bare `{ error: string }`, invalid per the MCP SDK's own `CallToolResultSchema` (`content`
  required, `isError` a separate optional flag) — verified directly against the SDK's real schema,
  not assumed. Likely surfaced to a real MCP client as a transport/parse failure rather than the
  actual error message. Verified by spawning the real built server and dispatching a real invalid
  tool call end-to-end. Independent of the still-open MCP SDK major-version upgrade (see Next).
- Kotlin module labeling (spec 051) — new path-derived `Node.module` field (`forro/feature`,
  `app`, ...), no `settings.gradle` parsing needed — research found path-derivation not just
  simpler but *more* robust than regex-parsing `settings.gradle` on real projects (some real
  projects build their module list programmatically, unparseable by any regex). Real verification
  against `vv-viaunica-android` found all 42 modules the project's own `settings.gradle.kts`
  declares. Real verification also caught and fixed a genuine false-positive bug: an initial
  generic `/src/` split wrongly tagged this very repo's own TypeScript `packages/<name>/src/`
  layout — fixed by gating the module boundary on the same Kotlin/Java convention `sourceSet`
  (spec 049) already requires. This same re-sync fixed a stale real-data discrepancy left over from
  spec 049, whose own verification had only ever targeted a temporary data directory.
- All-pairs near-duplicate grouping (spec 052) — new `detectNearDuplicates()`, the "Spec B" spec
  048 explicitly deferred. Research found spec 048's own stated blockers (LSH banding, a breaking
  `DuplicateGroup` change, fresh calibration) were all overstated once measured for real — no LSH
  needed at real project scale, zero consumers read `DuplicateGroup.hash` so the new type is fully
  additive, and spec 048's calibration reused as-is. Real-scale verification against a large real
  project's actual synced graph caught **two** genuine bugs before shipping: a `Math.min(...array)`
  spread crashing on a huge real group, and — more fundamentally — the originally planned
  single-linkage transitive-closure semantic merging 7,607 real, unrelated functions into one
  meaningless group. Fixed by switching to a quasi-clique requirement (every member pairwise
  similar to every other member, not merely chain-reachable); the same real project's largest group
  then dropped to a genuine, inspected 312-member cluster of near-identical Android test
  boilerplate. New `nodum duplicates --fuzzy` and a `near-duplication` category in
  `suggest_refactoring`.

### Viewer Sync fix, MCP SDK version bump, KMP expect/actual edges — shipped as real npm v2.12.0 (specs `053`–`055`)
Batch-scoping research for this release again found every one of its three candidates smaller or
more concretely scoped than the prior roadmap framing implied — the KMP entry below turned out to
be the clearest example yet of this project's "research before trusting the roadmap's own framing"
practice paying off.
- Fixed the viewer's broken Sync button (spec 053) — found while researching `packages/server`
  auth: `packages/viewer/app.js` called a `POST /api/sync` endpoint that has never existed
  (`app.ts` even already carried a comment confirming this was deliberate). Removed the dead
  button rather than building the endpoint, since `packages/server` has been read-only by design
  since spec 047 and adding a write endpoint would reopen exactly the surface that hardening
  closed.
- MCP SDK version bump (spec 054) — bumped `@modelcontextprotocol/sdk` from `^0.7.0` to `^1.30.0`,
  scoped to keep the deprecated-but-still-supported low-level `Server`/`setRequestHandler` API this
  codebase already uses (confirmed unchanged in 1.30.0, not removed) rather than the riskier
  `McpServer`/`registerTool` rewrite, which stays deferred. Added `zod` as an explicit dependency
  (now a non-optional SDK peer dependency) and `index.ts`'s first-ever test coverage. Verified by
  spawning the real built server on the bumped SDK and dispatching real tool calls end-to-end.
- KMP `expect`/`actual` edges (spec 055) — the real remaining KMP prerequisite this roadmap had
  named since v2.9.0. Research found the roadmap's own framing partly stale: Kotlin's *default
  hierarchy template* means the "source-set dependency graph" is almost never explicitly declared
  in a real project's Gradle files at all (confirmed by grepping a real KMP project's actual build
  files for `dependsOn`: zero occurrences) — parsing it would have found nothing. New
  `Node.platformModifier` field and `actualizes` edge, pairing `expect`/`actual` declarations by
  Gradle module + declaration kind + name, validated against Kotlin's default hierarchy convention
  internally rather than exposed as a separate graph artifact. Real verification against a genuine
  local KMP project found and worked around a real, unrelated environmental Node/V8 crash during
  full-monorepo parsing, then confirmed all 18 real `actual` declarations correctly paired to their
  9 real `expect` counterparts.

### Tree-sitter parser leak fix, MCP registerTool migration — shipped as real npm v2.13.0 (specs `056`–`057`)
Scoped by actually researching what was real before committing to anything, in direct response to
being asked "what's expected for v2.13.0?" after v2.12.0 shipped — the same research-first practice
every batch has used, this time applied explicitly at the user's prompt rather than assumed. Both
candidates researched here were items ROADMAP.md itself had gotten wrong in a prior batch: the
Node/V8 crash entry's own speculation (concurrency) and the MCP `registerTool` rewrite's own framing
("reshapes shared infra non-mechanically") were each corrected by research before any code was
written.
- Tree-sitter parser memory leak fix (spec 056) — a real, confirmed bug: every tree-sitter parser
  created a fresh `TSParser` per file but never freed it, only the parsed tree. Fixed and verified
  via a real regression test. **Honestly, this did not fully resolve the crash it was investigating**
  — see the "Known issue" entry below for the complete, updated account: re-verification confirmed
  the original crash is genuinely Node-version-specific (didn't reproduce on Node 22 LTS), but
  surfaced a second, separate, real stack-overflow bug in the process. The leak fix itself is real
  and kept regardless — a genuine resource leak with zero downside to fixing — but this spec's
  headline framing is deliberately not "fixed the crash," because it didn't, fully.
- MCP `registerTool` migration (spec 057) — migrated off the deprecated `Server`/`setRequestHandler`
  API onto `McpServer`/`registerTool`. All 14 tool schemas rewritten as zod (mechanical);
  `handlers.ts` untouched. Found and fixed a real TypeScript compiler limitation along the way:
  `@modelcontextprotocol/sdk`'s deeply conditional zod-compat types trigger a genuine
  `TS2589` "type instantiation excessively deep" error under this monorepo's classic `node` module
  resolution — reproduced with the SDK's own simplest possible usage in isolation, fixed with a
  `moduleResolution: "bundler"` override scoped to `packages/mcp` alone. Invalid-args/unknown-tool
  calls no longer produce a metrics log entry (the SDK now owns that routing before any callback
  runs) — a real, disclosed, deliberately-accepted behavior change, verified against actual log
  output rather than assumed from the SDK's types.

---

## Next

### Dart/Flutter — still its own future initiative
KMP's own remaining prerequisite shipped in spec 055 (v2.12.0) — see above. Dart/Flutter is a
separate initiative with its own real prerequisite: `pubspec.yaml` resolution — this codebase's
first build-file reader — plus a decision on how to widen `Parser.resolveImport()`'s currently
project-config-blind interface. Not a one-release-away item; needs its own scoped batch, same
posture the v2.9.0 entry originally set for both KMP and Dart/Flutter together.

### Cross-language duplication detection — still blocked on an unbuilt prerequisite
Specs 048 and 052 (v2.10.0/v2.11.0) built the same-language near-duplicate *lookup* and *grouping*
prerequisites this roadmap named since v2.1.0. A cross-language layer on top still cannot be built
as an extension of either — different languages produce disjoint token vocabularies by
construction, so it needs its own similarity mechanism entirely, deferred as its own future spec,
not restated as imminent.

### `packages/server` real authentication — considered and declined again for v2.12.0
Re-considered during this batch's `packages/server`-adjacent research (which instead found and
fixed the broken viewer Sync button, spec 053) and still judged not worth building: the residual
risk requires a deliberate `NODUM_HOST` opt-in to a non-loopback bind, and the package remains
read-only/metadata-only. A token/session auth scheme for that specific opt-in case remains a real
future item, not urgent enough to force into a batch twice in a row now.

### Kotlin `expect`/`actual` — real refinements found during spec 055, deliberately not expanded on
Spec 055 (v2.12.0) scoped `expect`/`actual` edge detection to top-level functions and types
(`class`/`interface`/`enum`/`object`). Real end-to-end verification against a genuine KMP project
found two further real gaps — documented here rather than left implied by their absence, since
neither was a hypothetical concern:
- **`expect class` members are not walked.** A nested declaration inside an `expect`/`actual class`
  body (the real verification project's own `HttpClientEngineProvider.provideEngine` case) gets no
  `platformModifier` at all today. Extending the existing class-body member walk to also check each
  member for a platform modifier is a real, likely-small follow-up, but wasn't attempted alongside
  the top-level case.
- **`expect`/`actual` on top-level properties (`val`/`var`) can't be detected**, because this parser
  has never extracted Kotlin top-level properties as graph nodes *at all* — a pre-existing
  limitation, not introduced by spec 055. A real `expect val platformModule: Module` declaration in
  the verification project was confirmed correctly left untagged (there is no node to tag). Fixing
  this for real would mean adding top-level-property node extraction as its own parser feature
  first, not a small addition to the pairing logic.
- **Matching is module + declaration kind + label only, with no package-path awareness** — this
  parser has never extracted Kotlin `package` declarations either. Verified sufficient against the
  one real project used for spec 055's verification (a same-name collision across two different
  modules was already disambiguated by module-scoping alone), but this is a verified-sufficient-once
  finding, not a proof that every real project's naming can't collide within a single module. Worth
  re-checking against a second real KMP project before treating it as fully settled.

None of these three are scoped to any release yet.

### Known issue: full-project sync doesn't complete on either tested Node version, for two separate real reasons
Originally discovered during spec 055's real end-to-end verification (a real ~21,447-file Kotlin
Multiplatform monorepo, well over the 20,000-file `.nodumrc.json` guardrail, crashed this machine's
Node `v25.9.0` with a `Fatal process out of memory: Zone` V8 WASM-compilation error). Spec 056
(v2.13.0) investigated this fully and found the roadmap's own prior speculation (concurrency-related)
was wrong — `parseFilesInto` is fully sequential, nothing to cap — and instead found a real, confirmed
bug: every tree-sitter parser leaked a `TSParser` instance per file (fixed in spec 056). **Real
re-verification against the exact same project found the leak fix alone does not resolve the
original crash**:
- **Re-tested on the same Node `v25.9.0`, with the fix applied**: crashed identically, in the same
  ~2 seconds — the leak wasn't the (sole) cause of this specific crash.
- **Tested on Node 22 LTS** (installed specifically for this check): the original V8 WASM crash did
  **not** reproduce at all — it ran for over two hours instead of crashing in seconds, confirming
  that specific crash genuinely is Node-version-specific (this machine's `v25.9.0` or that general
  V8 vintage), not something this codebase's own code fully controls.
- **But after those two-plus hours, Node 22 hit a second, different, real, previously-unknown bug**:
  `RangeError: Maximum call stack size exceeded` — a genuine JavaScript call-stack overflow inside
  this codebase's own recursive AST-walking logic (candidates: the `visit()`-shaped recursive walks
  in each tree-sitter parser's complexity/duplicate-token/call-extraction functions), triggered by
  some real file elsewhere in this specific project deep/large enough to exceed the default
  call-stack limit. Not visible before, because the Node 25.9.0 crash happened first and masked it.

**Neither Node version tested fully syncs this specific real project, for two unrelated reasons.**
The parser leak fix (spec 056) is real, verified, and worth keeping regardless — but package.json's
`"engines": ">=18.0.0"` was deliberately **not** narrowed, since neither tested version cleanly
completes this project; there is no "known-good" range to narrow to with confidence yet.

Not scoped to any release yet — flagged here so it isn't lost, not silently dropped. Worth
investigating as its own future item:
- **Get a real stack trace for the `Maximum call stack size exceeded` error** without needing
  another multi-hour real-project sync — `packages/cli/src/commands/sync.ts:43` currently discards
  the original error's stack, keeping only `error.message`. Fixing that first would make the next
  investigation step far cheaper.
- Once the real stack trace identifies which recursive function and which real file trigger the
  overflow, assess whether an iterative (explicit-stack) rewrite of that walk, or a depth guard, is
  the right fix — don't guess at a fix blind.
- Whether the original V8 WASM crash is specific to Node `v25.9.0` particularly (worth documenting a
  known-good Node version range once the stack-overflow bug is also resolved and a full real
  end-to-end pass actually succeeds on some version) or a broader vintage-of-V8 issue.

### v3.0.0 — MCP-native, semantically deep

**This is a reframe of the old "multi-AI hub" vision, not its continuation.** The original v3.0
draft centered on per-provider adapters — a Claude adapter, an OpenAI adapter, a Gemini
adapter, each hand-built. MCP already gives most of that for free: any MCP-speaking client (Claude
Code, Cursor, Zed, Continue) can already use Nodum's server today, with zero per-provider code.
Building a bespoke adapter layer on top would mean re-implementing what already ships.

**What holds from the original vision:** the ambition to be a durable, tool-agnostic source of
truth for a codebase. **What doesn't:** that the moat is provider breadth. The moat is graph
quality — call edges, type flow, and numbers an agent can trust, across the languages a team
actually writes in.

- The `McpServer`/`registerTool` migration itself shipped in spec 057 (v2.13.0) — the SDK now
  natively validates every tool's `inputSchema` via zod at the protocol layer, replacing the old
  `as any` casts. (Protocol-valid `isError` responses already shipped in spec 050, independent of
  the SDK version.)
- Verify against multiple real MCP clients (Claude Code, Cursor, Zed, Continue) — same server, no
  per-provider code, as the actual proof this reframe is real rather than aspirational.
- Type inference and data-flow edges — real accuracy headroom that isn't just "read more files."
- **Real authentication for `packages/server`** — see the dedicated "Next" entry above; considered
  and declined twice now (v2.11.0 and v2.12.0) as not yet urgent enough to force in.

**Success metrics change accordingly** — not GitHub stars or provider count, but **tokens spent
per correct agent answer**, tracked per release against real repositories, per the v2.5.0
measurement harness.

---

## Housekeeping — fold into whichever release touches the area

Nothing currently open — the four items previously listed here were resolved in spec 046 (v2.10.0)
and are recorded below alongside this roadmap's other already-resolved items, rather than left
implied by their absence.

**Already resolved, despite earlier drafts of this roadmap listing them as open:**
- ~~Link all four packages in Changesets so a release is real and taggable~~ — done in spec 023
  (`.changeset/config.json`'s `fixed` group).
- ~~Move `benchmarks/` into CI~~ — done in spec 028 (`.github/workflows/benchmark-accuracy.yml`).
- ~~Stop committing compiled `dist/`~~ — already gitignored; not present in the tree.
- ~~Delete the orphaned root `/viewer/`~~ — done in spec 046; `packages/viewer` was already the
  real, maintained source.
- ~~Delete `claude skills/sync-rag/`~~ — done in spec 046.
- ~~Reconcile the root `package.json` version~~ — done in spec 046 (now `2.9.0` as of that spec;
  update again if this cosmetic field drifts).
- ~~Reconcile `CHANGELOG.md`~~ — checked in spec 046 and found already correctly scoped to
  pre-v2.1.0 history, deferring to `packages/*/CHANGELOG.md` from v2.1.0 on; no change needed.

---

## Why this order

1. **v2.0–v2.1:** prove the Claude integration works, then make it fast enough for large
   codebases.
2. **Truth & measurement (v2.5.0):** a hard gate — every efficiency claim had to become real and
   measured before any new feature shipped on top of it, so future work has something honest to
   compare against.
3. **Tree-sitter (v2.6.0):** the parser foundation every subsequent language (iOS, Go, Kotlin's own
   eventual migration) needs — adding a language should mean writing a grammar and a query file,
   not a new hand-rolled parser.
4. **iOS → adaptive budgeting → Go/Kotlin/cognitive complexity:** iOS proved the plugin
   architecture holds under a genuinely different language family; budgeting (v2.8.0) spends the
   resulting token savings deliberately instead of accidentally, and made the underlying
   discovery/parsing pipeline faster and safer while doing it; v2.9.0 added the cheapest remaining
   language (Go), finally migrated Kotlin off regex, and used that to unlock a real second
   complexity metric — while being honest that KMP/Dart/Flutter needed more prerequisite work than
   originally scoped, rather than shipping them half-right.
5. **A smaller, cleanup-and-fix release (v2.10.0):** rather than force another language or a risky
   research bet, this batch closed out the same-language near-duplicate prerequisite the roadmap
   had carried since v2.1.0, fixed a real security bug and a real stack-detection bug both found
   during scoping (not invented for the release), and cleared the small housekeeping backlog —
   proof this project ships the right-sized thing for what a batch's own research actually finds,
   not always another feature.
6. **Protocol fix, module labeling, near-duplicate grouping (v2.11.0):** three candidates that
   scoping research found smaller/more tractable than assumed, each shipped with real end-to-end
   verification that caught genuine bugs before release — including one (near-duplicate grouping's
   originally planned semantic) that was wrong in a way no synthetic test at small scale would have
   surfaced, only a real project's actual data. Proof this project's "verify against real data
   before trusting a design" practice catches correctness bugs, not just performance ones.
7. **Viewer fix, SDK bump, KMP expect/actual edges (v2.12.0):** closed out the real remaining KMP
   prerequisite this roadmap had carried since v2.9.0 — and found, in the process, that its own
   framing of that prerequisite (Gradle-parsed source-set dependencies) was itself stale, the same
   class of correction v2.7.0's roadmap claim about KMP received back in v2.9.0. Real verification
   against a genuine local KMP project also caught a real environmental limitation (a Node/V8 crash
   unrelated to this project's own logic) and worked around it rather than skipping the check.
8. **Parser leak fix, MCP registerTool migration (v2.13.0):** scoped by directly researching what
   was actually real for "the next release" rather than assuming anything from the roadmap's own
   prior framing — which research corrected in both directions again (the crash wasn't about
   concurrency; the `registerTool` rewrite wasn't still risky). The parser-leak spec is this
   project's most transparent example yet of reporting an incomplete result honestly: the fix
   shipped because it's a real, independently-valuable bug fix, while the roadmap plainly states it
   did not fully resolve the crash that motivated finding it, and a second, new, real bug found in
   the process is tracked openly rather than folded in or hidden.
9. **v3.0:** the reframed vision — MCP-native portability instead of a bespoke adapter layer,
   validated by real numbers instead of asserted ones.

---

## Related docs

- [`docs/development/completed/`](./completed/) — every shipped spec, in order, each with its
  own real verification evidence.
- [`docs/development/active/`](./active/) — specs currently in progress.
- [`benchmarks/README.md`](../../benchmarks/README.md) — the measurement harness referenced
  throughout this roadmap.

Questions? Open an issue on [GitHub](https://github.com/caiquebrito/nodum/issues).
