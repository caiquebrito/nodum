# Nodum Roadmap

**Last updated:** 2026-07-28 · **Current release:** v2.8.0 (all four packages, lockstep) · **Specs shipped:** 43 (`docs/development/completed/`)

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

---

## Next

### v2.9.0 — Cross-platform mobile: KMP, Flutter, Go
**Goal:** reuse the machinery the iOS work forces into existence.
- Kotlin Multiplatform: `expect`/`actual` edges, source-set awareness — needs the Gradle-aware
  module roots the iOS release (v2.7.0) builds.
- Dart/Flutter grammar + `pubspec.yaml` resolution.
- Go — highest-value non-mobile addition, cheap to add once the multi-grammar plumbing exists.
- Cognitive complexity and cross-language duplication detection, both explicitly deferred in the
  v2.1.0 specs.
- This is also the natural point to finally migrate Kotlin's still-regex parser to tree-sitter,
  once a better grammar exists or vendoring `tree-sitter-grammars/tree-sitter-kotlin` becomes
  worth the maintenance cost.

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

- Upgrade the MCP SDK off `^0.7.0`; validate `inputSchema`s at runtime instead of `as any` casts;
  proper `isError` responses instead of ad hoc error shapes.
- Verify against multiple real MCP clients (Claude Code, Cursor, Zed, Continue) — same server, no
  per-provider code, as the actual proof this reframe is real rather than aspirational.
- Type inference and data-flow edges — real accuracy headroom that isn't just "read more files."
- Harden `packages/server`: currently unsanitized `:projectName` path interpolation, no auth, a
  hardcoded port, and zero tests.

**Success metrics change accordingly** — not GitHub stars or provider count, but **tokens spent
per correct agent answer**, tracked per release against real repositories, per the v2.5.0
measurement harness.

---

## Housekeeping — fold into whichever release touches the area

- **Delete the orphaned root `/viewer/`.** `packages/viewer` is the real, maintained source;
  `packages/server`'s build step already copies from it fresh on every build
  (`rm -rf viewer && cp -R ../viewer viewer`). The root-level `/viewer/` is a stale, tracked
  duplicate that nothing reads.
- **Delete `claude skills/sync-rag/`** — an abandoned v0 Python artifact with hardcoded personal
  paths, referenced by nothing in the current codebase.
- **Reconcile the root `package.json` version** (currently `2.4.0`) against the real, lockstep
  package version (`2.8.0` as of this writing) — it's a private/`workspaces`-only manifest, not
  published, but a stale number here is confusing for anyone reading it directly.
- Reconcile `CHANGELOG.md` — verify it reflects the real per-package Changesets-generated
  changelogs (`packages/*/CHANGELOG.md`) rather than drifting as a separate hand-maintained file.

**Already resolved, despite earlier drafts of this roadmap listing them as open:**
- ~~Link all four packages in Changesets so a release is real and taggable~~ — done in spec 023
  (`.changeset/config.json`'s `fixed` group).
- ~~Move `benchmarks/` into CI~~ — done in spec 028 (`.github/workflows/benchmark-accuracy.yml`).
- ~~Stop committing compiled `dist/`~~ — already gitignored; not present in the tree.

---

## Why this order

1. **v2.0–v2.1:** prove the Claude integration works, then make it fast enough for large
   codebases.
2. **Truth & measurement (v2.5.0):** a hard gate — every efficiency claim had to become real and
   measured before any new feature shipped on top of it, so future work has something honest to
   compare against.
3. **Tree-sitter (v2.6.0):** the parser foundation every subsequent language (iOS, KMP, Flutter,
   Go) needs — adding a language should mean writing a grammar and a query file, not a new
   hand-rolled parser.
4. **iOS → adaptive budgeting → cross-platform mobile:** iOS proved the plugin architecture holds
   under a genuinely different language family; budgeting (v2.8.0) spends the resulting token
   savings deliberately instead of accidentally, and made the underlying discovery/parsing
   pipeline faster and safer while doing it; cross-platform mobile reuses everything iOS forced
   into existence.
5. **v3.0:** the reframed vision — MCP-native portability instead of a bespoke adapter layer,
   validated by real numbers instead of asserted ones.

---

## Related docs

- [`docs/development/completed/`](./completed/) — every shipped spec, in order, each with its
  own real verification evidence.
- [`docs/development/active/`](./active/) — specs currently in progress.
- [`benchmarks/README.md`](../../benchmarks/README.md) — the measurement harness referenced
  throughout this roadmap.

Questions? Open an issue on [GitHub](https://github.com/caiquebrito/nodum/issues).
