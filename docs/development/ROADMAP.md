# Nodum Roadmap

**Last updated:** 2026-07-29 · **Current release:** v2.11.0 (all four packages, lockstep) · **Specs shipped:** 53 (`docs/development/completed/`)

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

---

## Next

### KMP and Dart/Flutter — each its own future initiative
Not "next release" bullets — each needs real prerequisite work scoped as its own batch before it's
a one-release-away item again (see the v2.9.0 entry for why each was deferred rather than
attempted; v2.10.0/v2.11.0 shipped source-set/module *labeling* — specs 049 and 051 — which is real
progress but not the whole prerequisite):
- **Kotlin Multiplatform**: the source-set *dependency* graph (`commonMain ← iosMain`) is the
  remaining genuine prerequisite — `expect`/`actual` edges are symbol-to-symbol, not file-to-file,
  and need a resolution mechanism this codebase doesn't have yet. `settings.gradle` module-map
  parsing itself is no longer on this list — spec 051's research found pure path-derivation is not
  just simpler but *more* robust on real projects than parsing `settings.gradle` would have been.
- **Dart/Flutter**: needs `pubspec.yaml` resolution — this codebase's first build-file reader —
  plus a decision on how to widen `Parser.resolveImport()`'s currently project-config-blind
  interface.

### Cross-language duplication detection — still blocked on an unbuilt prerequisite
Specs 048 and 052 (v2.10.0/v2.11.0) built the same-language near-duplicate *lookup* and *grouping*
prerequisites this roadmap named since v2.1.0. A cross-language layer on top still cannot be built
as an extension of either — different languages produce disjoint token vocabularies by
construction, so it needs its own similarity mechanism entirely, deferred as its own future spec,
not restated as imminent.

### MCP SDK major-version upgrade — deliberately not bundled with the v2.11.0 protocol fix
Spec 050 (v2.11.0) fixed a real, mechanical, low-risk protocol bug (`isError`/`content` shape) that
needed no SDK version change at all. The SDK itself is still pinned `^0.7.0` against a current
`1.30.0` — a real breaking-change risk (`Server`/`setRequestHandler` → `McpServer`/`registerTool`,
transport rework, zod v4) that this batch's research explicitly declined to bundle in, deferring it
to its own future investigation spike. Runtime `inputSchema` validation via zod (replacing today's
`as any` casts) is deferred alongside it, to avoid redoing the work once SDK 1.x's `registerTool`
would natively consume zod schemas.

### `packages/server` real authentication — considered and declined for v2.11.0
This batch's scoping research found spec 047's fix (v2.10.0: loopback-only default bind, path-
traversal sanitization, first real test suite) already essentially sufficient — the residual risk
requires a deliberate `NODUM_HOST` opt-in to a non-loopback bind, and the package remains read-only/
metadata-only. A token/session auth scheme for that specific opt-in case remains a real future item,
not urgent enough to force into this batch.

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

- Upgrade the MCP SDK off `^0.7.0`; validate `inputSchema`s at runtime instead of `as any` casts —
  see the "MCP SDK major-version upgrade" entry above for why this stayed deferred past v2.11.0.
  (Protocol-valid `isError` responses already shipped in spec 050, independent of the SDK version.)
- Verify against multiple real MCP clients (Claude Code, Cursor, Zed, Continue) — same server, no
  per-provider code, as the actual proof this reframe is real rather than aspirational.
- Type inference and data-flow edges — real accuracy headroom that isn't just "read more files."
- **Real authentication for `packages/server`** — see the dedicated "Next" entry above; considered
  and declined for v2.11.0 as not yet urgent enough to force in.

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
7. **v3.0:** the reframed vision — MCP-native portability instead of a bespoke adapter layer,
   validated by real numbers instead of asserted ones.

---

## Related docs

- [`docs/development/completed/`](./completed/) — every shipped spec, in order, each with its
  own real verification evidence.
- [`docs/development/active/`](./active/) — specs currently in progress.
- [`benchmarks/README.md`](../../benchmarks/README.md) — the measurement harness referenced
  throughout this roadmap.

Questions? Open an issue on [GitHub](https://github.com/caiquebrito/nodum/issues).
