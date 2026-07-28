# Nodum Roadmap

**Last updated:** 2026-07-28 · **Current release:** v2.6.0 (all four packages, lockstep) · **Specs shipped:** 36 (`docs/development/completed/`)

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

---

## Next

### v2.7.0 — iOS: Swift + Objective-C (specs 036–039, implemented — release pending)
**Goal:** prove the plugin architecture with a language family that shares nothing with the
existing ones. If `graph-gen.ts` or `file-discovery.ts` need to change to add Swift, the
tree-sitter foundation (v2.6.0) was incomplete. **Verified: zero changes to either file across
all four specs.**
- Swift and Objective-C as grammar + query + registry entry (specs 037, 038) — `class`/`struct`/
  `enum`/`actor`/`extension` all fold into one Swift grammar node, disambiguated by keyword; ObjC
  type nodes come only from `@implementation`/`@protocol`, never a bare `@interface`, to avoid
  splitting one class into two nodes across its header/implementation pair.
- Extend `NodeType` with `struct`/`enum`/`protocol`/`extension` (spec 036) — batched as one
  deliberate breaking change rather than trickled in, ahead of either parser so neither re-types
  a node on a follow-up release.
- **Interop shipped reduced in scope, deliberately (spec 039): file-level `imports` edges only**
  — a Swift `import Foo` resolves to `Foo`'s `.m`/`.h` files and vice versa (verified on a real
  mixed fixture: a bridging header, an ObjC class, and a Swift file importing it all render as one
  connected graph component, not two disconnected islands). **`@objc` annotations and
  Swift↔ObjC `calls` edges are NOT included** — the only cross-file edge mechanism in the system
  is import resolution (`relation: 'imports'`, file-to-file); symbol-level cross-language calls
  would need a new `resolveCall?()`-style mechanism touching `graph-gen.ts`, which is exactly what
  this release's litmus test says not to do. Deferred to a future spec, same posture as spec 034
  deferring cross-file `calls` within a single language.
- Module resolution via directory-suffix matching (mirroring how JVM dotted-FQN imports already
  resolve) — **not** `Package.swift`/`.xcodeproj`/`Podfile` parsing, a deliberate reduction
  matching the precedent `resolveJvmImport` already set for `pom.xml`/`build.gradle`.

### v2.8.0 — Adaptive context budgeting
**Goal:** stop guessing at output size; spend a token budget deliberately, provable against the
v2.5.0 measurement harness.
- Accept a token budget as an MCP parameter; fill it greedily by relevance instead of truncating
  at fixed `.slice()` counts.
- Real modularity clustering (Louvain/Leiden) over `calls` + `imports` edges together — the
  `calls` edge from v2.6.0 was inert data until something consumes it; this is the first consumer.
- In-process graph cache — `handlers.ts` currently re-parses `graph.json` from disk on every
  single MCP tool call.
- Parallelize file parsing; add file-count/size limits (none exist today).

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
  package version (`2.6.0` as of this writing) — it's a private/`workspaces`-only manifest, not
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
4. **iOS → adaptive budgeting → cross-platform mobile:** iOS proves the plugin architecture holds
   under a genuinely different language family; budgeting spends the token savings deliberately
   instead of accidentally; cross-platform mobile reuses everything iOS forced into existence.
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
