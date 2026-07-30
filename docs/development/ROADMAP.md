# Nodum Roadmap

**Last updated:** 2026-07-30 · **Current release:** v2.16.0 (all four packages, lockstep) · **Specs shipped:** 61 (`docs/development/completed/`)

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

### Preserve the real stack trace on sync failures — shipped as real npm v2.14.0 (spec `058`)
A single, small, standalone spec, released on its own rather than held for a future batch — the
direct first step named in the "Known issue" entry below, requested and shipped immediately rather
than left to accumulate alongside unrelated work.
- `nodum sync` failures now print the real underlying stack trace, not just a message (spec 058).
  `packages/cli/src/commands/sync.ts` already attached the original error via `.cause`, but nothing
  ever printed it — `bin/nodum.ts`'s `sync` command's catch block only logged `error.message`. Now
  appends the original error's real `.stack` onto the wrapped error's own `.stack` and prints it,
  verified via a real forced failure end-to-end. Directly unblocks investigating the
  `Maximum call stack size exceeded` bug (see below) without needing another expensive multi-hour
  real-project sync just to see where it happens.

### Fix `applyExpectActual`'s array-spread stack overflow — shipped as real npm v2.15.0 (spec `059`)
Closes the investigation started in spec 056 and continued in spec 058. Spec 058's stack-trace fix
paid off immediately: re-running the exact same real ~21,447-file KMP project on Node 22 LTS
surfaced a real stack trace on the first attempt, pointing directly at `expect-actual.ts`, not any
tree-sitter parser's recursive AST walk as the roadmap had speculated.
- `applyExpectActual`'s stale-edge cleanup used `edges.length = 0; edges.push(...preserved);` —
  spreading a ~200,000+-element array as individual `push()` call arguments, which overflows V8's
  call-stack argument limit. The same class of bug spec 052 already found and fixed once elsewhere
  (`Math.min(...similarities)`), recurring independently here because that lesson didn't carry over
  to code written in a later spec. Fixed with an in-place filter loop; a new regression test
  reproduces the crash at 300,000 elements and confirms the old code really did throw before
  trusting the fix.
- **Real check: the exact real ~21,447-file project that never once fully synced across specs 055,
  056, and 058 completed end to end for the first time** — 246,186 real dependencies, 131,395 nodes,
  18 correct `expect`/`actual` pairs, matching spec 055's smaller-fixture result exactly.
- Confirmed via full grep that no other live instance of the spread-into-call-arguments pattern
  remains anywhere in the codebase.
- **Out of scope, deliberately**: the original Node `v25.9.0`-specific V8 WASM out-of-memory crash
  (see "Known issue" below) — that crash happens during file parsing itself, before
  `applyExpectActual` ever runs. This spec fixed the second bug the crash was masking, not the
  crash itself.

### Work around the Node/V8 WASM compiler crash on large syncs — shipped as real npm v2.16.0 (spec `060`)
Closes the four-spec investigation arc (055 → 056 → 058 → 059 → 060) into the original Node
`v25.9.0` crash — the one item spec 059 explicitly left open. Re-tested the exact same real
~21,447-file project on `v25.9.0` and confirmed the crash still reproduced after spec 059's fix, as
expected, then root-caused it for real instead of continuing to guess.
- **Genuinely a V8 bug, not this codebase's**: the real native stack trace is unambiguous —
  `Zone::Expand` → `SnapshotTable::MergePredecessors` → `WasmLoweringReducer` →
  `Pipeline::Run<WasmLoweringPhase>` → `ExecuteTurboshaftWasmCompilation` →
  `BackgroundCompileJob::Run`. Every frame is inside V8's own Turboshaft WASM optimizing compiler,
  compiling a tree-sitter grammar module — not this codebase, not `web-tree-sitter`, not the JS
  heap (so `--max-old-space-size` was never going to help; `Zone` is a separate compiler arena).
- **Narrowed the real trigger by elimination, with real measurements**: `--wasm-num-compilation-tasks=1`
  and `--no-wasm-tier-up` both still crashed; `--liftoff-only` (forcing V8's baseline WASM compiler,
  never invoking the optimizer) did not — the real project completed in ~12 minutes.
- **Verified the "free" fixes don't work before reaching for a bigger one**: `NODE_OPTIONS` rejects
  `--liftoff-only` outright (Node's flag allowlist), and calling `v8.setFlagsFromString()` at
  runtime still crashed identically — WASM tiering is decided too early in V8's startup for a
  runtime flip. A real process argument, set before V8 initializes, is the only mechanism that
  actually works.
- `nodum` and `nodum-mcp` now transparently re-exec themselves with `--liftoff-only` on every
  invocation (`ensureLiftoffOnly()`, shared from `packages/core` since the MCP server hits the same
  crash via its `sync_project` tool). **Real check: the exact real project now completes end to end
  on Node `v25.9.0` with zero manual flags** — 246,186 dependencies, matching every prior successful
  run exactly. Also verified: a non-sync command, a deliberately failing sync (correct exit code),
  and the MCP stdio transport (including a real `sync_project` call) all still work through the
  respawn.
- **This is a workaround for an upstream V8 bug, not a fix merged into V8 itself.** The tradeoff is
  WASM code compiled at Liftoff's baseline tier instead of Turboshaft's optimized tier — measured as
  a non-issue for this workload (a one-time parse per sync, not a hot loop).

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

### Closed: the Node `v25.9.0` large-project sync crash (spec 060 resolved it)
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
  `RangeError: Maximum call stack size exceeded`. Spec 058's stack-trace fix made this diagnosable,
  and spec 059 (v2.15.0) found and fixed the real cause on the first real re-run: not a tree-sitter
  parser's recursive AST walk as originally speculated, but `applyExpectActual`'s
  `edges.push(...preserved)` spreading a ~200,000+-element array into a function call. **Resolved —
  the exact same real ~21,447-file project now completes end to end on Node 22 LTS**, for the first
  time across this entire investigation (246,186 dependencies, 18 correct `expect`/`actual` pairs).

**What was still open after spec 059: the original Node `v25.9.0` V8 WASM crash itself.** Spec 060
re-tested it, confirmed it still reproduced (as expected — it happens during parsing, before either
of specs 056/059's fixes ever run), root-caused it to a genuine V8 optimizing-compiler bug via a
real native stack trace, and shipped a real, verified workaround (`--liftoff-only`, applied via a
transparent self-re-exec). **The exact real ~21,447-file project now completes end to end on Node
`v25.9.0` with zero manual configuration** — see the v2.16.0 entry above for the full account.

This is a workaround for an upstream V8 bug, not a fix merged into V8 itself — worth remembering if
a future Node/V8 upgrade changes this behavior. `package.json`'s `"engines": ">=18.0.0"` remains
un-narrowed, and now genuinely doesn't need narrowing: the reason it was left open was that no Node
version cleanly completed this project, and now every supported version does (with the workaround
in place).

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
9. **Sync stack-trace fix (v2.14.0):** a single, small, standalone spec — the concrete first step
   the v2.13.0 entry above named for investigating its own still-open stack-overflow bug — shipped
   on its own immediately rather than left to accumulate alongside unrelated work in a future batch.
10. **Fix the stack-overflow bug (v2.15.0):** a single, small, standalone spec that closed out the
    investigation v2.13.0 started and v2.14.0 unblocked. Spec 058's stack trace paid off on the very
    first real re-run: the real cause was one line in a completely different file/spec than either
    prior investigation had guessed, and the same real project that never once fully synced across
    three prior specs completed end to end for the first time. The original Node `v25.9.0` V8 crash
    the investigation started from remains open, tracked honestly rather than assumed fixed by
    association.
11. **Work around the V8 WASM compiler crash (v2.16.0):** closes the five-spec arc this investigation
    ran across (055 → 056 → 058 → 059 → 060). Rather than accept the original crash as permanently
    unresolvable, root-caused it for real — a genuine V8 optimizing-compiler bug, confirmed via a
    real native stack trace and elimination against measured V8 flags, not guessed at from
    documentation. Verified the cheaper fixes (`NODE_OPTIONS`, a runtime flag flip) didn't actually
    work before shipping the one that did. The exact real project this whole investigation was
    fought over now syncs end to end with zero user-facing configuration.
12. **v3.0:** the reframed vision — MCP-native portability instead of a bespoke adapter layer,
    validated by real numbers instead of asserted ones.

---

## Related docs

- [`docs/development/completed/`](./completed/) — every shipped spec, in order, each with its
  own real verification evidence.
- [`docs/development/active/`](./active/) — specs currently in progress.
- [`benchmarks/README.md`](../../benchmarks/README.md) — the measurement harness referenced
  throughout this roadmap.

Questions? Open an issue on [GitHub](https://github.com/caiquebrito/nodum/issues).
