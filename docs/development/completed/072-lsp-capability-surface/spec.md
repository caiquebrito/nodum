# 072 — LSP capability surface

## Status: done

Implemented as designed, with two real, disclosed deviations from the original sketch (both noted
inline below) and one genuine bug found only by spawning the real built binary, not caught by any
mocked unit test. New `packages/lsp` workspace (`@caiquebrito/nodum-lsp`, private/unpublished —
same posture as `packages/query`, since spec 073's per-IDE packaging is what actually makes this
installable by end users, not this spec). `nodum-lsp` starts over real stdio with zero required
flags and answers `initialize`, `workspace/symbol`, `textDocument/hover`,
`textDocument/documentSymbol`, `textDocument/codeLens`, `textDocument/references`,
`workspace/executeCommand`, and `textDocument/publishDiagnostics` — every capability this spec's
Scope table named.

**`packages/query` gained one new export**: `loadGraph` (previously module-private in
`handlers.ts`). The LSP server needs real, structured `Node`/`Edge` data (ranges, kinds,
cross-file locations) for `workspace/symbol`/`documentSymbol`/`references`/`codeLens` — the
existing `handleXxx` functions all return pre-formatted MCP text blocks, useless for building an
LSP `Location`/`Range`. Reusing `loadGraph` (rather than duplicating its `GraphCache`-backed disk
read) was the one deliberate, minimal touch to `packages/query` this spec needed.

**Deviation 1 — `workspace/symbol` is a plain case-insensitive label-substring filter over the
graph, not `handleSearch`'s hybrid keyword+semantic ranking**, despite the original Scope table
sketching it as "`handleSearch`-equivalent". `handleSearch`/`buildSmartContext` are tuned for
Claude's prose-context use case (relevance-ranked, token-budgeted, cached per conversation) — an
IDE's symbol quick-pick wants exact/substring name matches over the whole graph, capped at 100
results (mirroring spec 027's bound-expansion precedent), with no embedding-model dependency on
the hot path. Implemented directly in `packages/lsp/src/symbols.ts` against the raw `Graph`.

**Deviation 2 — the "auto-sync on first open" design decision (left open in the original spec) was
resolved as: sync only if no `graph.json` exists yet for this project.** `ProjectContext.ensureGraph()`
loads an already-synced project's graph straight from disk (near-instant); a never-before-synced
project gets one real full sync (with embeddings, via the same `handleSync` the MCP server's
`sync_project` tool calls) the first time any capability needs graph data — never inside
`onInitialize` itself, so the `initialize` handshake always responds immediately regardless of
project size. After that first load, every read comes from an in-memory `Graph` the class owns
directly; `didSave`/`didChangeWatchedFiles` calls `syncProject(..., { incremental: true })`
directly (bypassing `handleSync`) so an incremental resync on every save doesn't pay embeddings'
cost on a path with no semantic-search consumer.

**A real bug `benchmarks/`-style mocked tests never would have caught**: `createConnection(ProposedFeatures.all)`
with no explicit streams does **not** default to stdio — a real spawned-process check
(`node packages/lsp/dist/index.js`, sending a raw framed `initialize` request) failed immediately
with `Connection input stream is not set`, requiring either a `--stdio` CLI flag or explicit
streams. Fixed by binding `process.stdin`/`process.stdout` explicitly in `index.ts`, so
`nodum-lsp` works with zero required flags — matching this spec's own "starts over stdio"
acceptance criterion literally rather than requiring every future caller (spec 073's shims) to
remember a flag. A second, smaller bug from the same real check: `Position.create`'s `character`
was set to `Number.MAX_SAFE_INTEGER` (the "end of line" convention for a range with no tracked
end-column) but LSP's wire-format `uinteger` type caps at `2^31-1`
(`vscode-languageserver-types`' own `Is.uinteger` validates exactly this bound) — every
`nodeRange()` call threw until fixed to use `2147483647` instead.

**`packages/lsp/src/index.ts` is a 6-line bootstrap** (`ensureLiftoffOnly()` +
`createConnection()` + `createServer(...).start()`); all capability wiring lives in
`server.ts`'s `createServer(connection)`, taking an injectable `Connection` specifically so tests
don't need to spawn a real process to exercise it — real process spawning is reserved for the
one-time manual verification below, per this project's usual split between fast mocked unit tests
and a slower, real end-to-end check.

## Goal

Stand up a real `nodum-lsp` binary mapping nodum's graph queries onto standard Language Server
Protocol requests, so every LSP-speaking IDE (Android Studio, JetBrains family, Visual Studio,
VS Code, Neovim, Zed, ...) gets them without any per-IDE code.

## Why now

This is the concrete deliverable of the LSP-core strategy (`docs/development/ROADMAP.md` v3.0.0
section): reach IDEs that have no MCP client today. Diagnostics in particular are a capability
nodum's analyzers already compute (cycles, dead code, architecture violations) but currently
require an explicit CLI invocation to see — over LSP, they become inline squiggles in every
connected editor automatically, for free, once this spec lands.

## Scope

- New workspace `packages/lsp`, added to root `package.json`'s `workspaces` array, built after
  `core`/`query` in the existing sequential build chain (`build:core && ... && build:lsp`).
  Dependencies: `vscode-languageserver` (`^10.1.0`) + `vscode-languageserver-textdocument`
  (`^1.0.12`) — the standard, editor-agnostic LSP server implementation libraries. Bin:
  `nodum-lsp` → `packages/lsp/dist/index.js`. `moduleResolution: "bundler"` override in this
  package's own `tsconfig.json` — same fix, same scoping as spec 057 applied for the MCP SDK:
  `vscode-languageserver`'s `./node` exports-map subpath isn't resolvable under the root
  tsconfig's classic `"node"` resolution.
- `packages/lsp/src/index.ts` calls `ensureLiftoffOnly()` (`@caiquebrito/nodum-core`) first,
  exactly as `packages/cli/src/bin/nodum.ts` and `packages/mcp/src/index.ts` already do (spec
  060's Node/V8 WASM crash workaround).
- LSP requests implemented, each in its own module (`symbols.ts`, `hover.ts`, `code-lens.ts`,
  `references.ts`, `diagnostics.ts`, `commands.ts`), wired in `server.ts`:
  - `workspace/symbol` — label-substring match over the graph, capped at 100 (see Deviation 1
    above).
  - `textDocument/hover` — the node at the requested position's `buildNodeContext` summary, via
    `handleGetNode` (label, type, file, module/layer, dependencies, used-by).
  - `textDocument/documentSymbol` — every non-file node whose `file` matches the requested
    document.
  - `textDocument/codeLens` — "N dependents · complexity X" per function/method/class/struct/
    enum/protocol/interface, command-wired to `nodum.traceImpact`.
  - `textDocument/references` — every node whose edge targets the symbol at the given position
    (the reversed direction of `handleGetDeps("incoming")`), respecting `includeDeclaration`.
  - `workspace/executeCommand` — `nodum.sync` (incremental resync + diagnostics refresh),
    `nodum.traceImpact`/`nodum.findSimilar` (thin wrappers over the matching `handleXxx`),
    `nodum.deadCode` (`detectUnreachableFiles`, entry-patterns resolved via
    `findManifestEntryFiles`+`findCiInvokedFiles`, same as `suggestRefactoring`).
  - `textDocument/publishDiagnostics` — `detectCycles`, `detectUnreachableFiles` (same
    manifest/CI entry-point resolution as above, so this doesn't reintroduce the false positives
    specs 061/062 fixed), and `detectArchitectureViolations` (opt-in via `.nodumrc.json`, same as
    `suggestRefactoring`) — all at `DiagnosticSeverity.Warning`.
- Server lifecycle: see "auto-sync" Deviation 2 above for the resolved design decision.
  `didSave`/`didChangeWatchedFiles` triggers `syncProject(..., { incremental: true })` and
  republishes diagnostics.

## Out of scope

- Per-IDE packaging (VSIX, JetBrains plugin, ...) — spec 073.
- Xcode — no general LSP client exists for it; covered separately (spec 074, expected to stay
  deferred).
- Write operations (code actions, refactoring, formatting) — nodum stays a read-only knowledge
  layer; `workspace/executeCommand` is the one write-adjacent surface (triggering sync/analysis),
  not editing code.

## Design

The `textDocument/publishDiagnostics` mapping is a formatting layer over already-computed
analyzer results, not new analysis — see `diagnostics.ts`. `nodeRange()`/`nodeUri()`
(`graph-utils.ts`) are the one shared conversion point every capability routes through: `Node.file`
is project-root-relative (confirmed against `file-discovery.ts` before assuming so), so every LSP
`Location` joins it against the project root captured at `initialize`; `Node.line` is 1-indexed
when present and converted once, centrally, rather than per call site.

## Acceptance criteria

- [x] `nodum-lsp` starts over stdio and responds to `initialize`. (Real spawned-process check —
      see Success Metrics.)
- [x] `workspace/symbol`, `textDocument/hover`, `textDocument/documentSymbol` return real data
      from a synced project's graph. (Same real check, against `sample-next-app`.)
- [x] `textDocument/publishDiagnostics` surfaces at least cycles and dead-code findings as LSP
      diagnostics. (Real check found a genuine dead-code finding in `sample-next-app`'s own
      `src/api/routes.ts`.)
- [x] `didSave`/`didChangeWatchedFiles` triggers an incremental re-sync and diagnostics refresh.
      (Unit-verified in `server.test.ts`; not re-verified against a real file-watch event — real
      check covered every request/response capability instead.)
- [x] `npm run build && npm test --workspaces` green — 973 tests total (51 new, in
      `packages/lsp`), zero failures.

## Test plan

51 tests across 10 files in `packages/lsp/src`: pure-function coverage for every capability module
against small hand-built fixture graphs (matching `packages/query/src/handlers.test.ts`'s existing
convention), `project.test.ts` covering both `ensureGraph()` branches (existing graph vs. first
full sync) plus concurrent-call deduping, `commands.test.ts` and `server.test.ts` (wiring/dispatch,
mocking each capability module — the same boundary `packages/mcp/src/index.test.ts` draws around
`registerTool` callbacks).

**The one integration-style test** (`integration.test.ts`) spins up a real, unmocked
`vscode-languageserver` `Connection` over an in-memory `PassThrough` stream pair (only the
`fs.existsSync`/`loadGraph` I/O boundary mocked) and drives real Content-Length-framed JSON-RPC
messages through it: `initialize` → capabilities assertion → `workspace/symbol` → `shutdown`,
verifying the actual wire protocol works, not just the handler functions in isolation. Its message
reader queues out-of-order messages by predicate rather than assuming strict request/response
ordering — required because the server emits real, unsolicited
`textDocument/publishDiagnostics` notifications interleaved with request responses, exactly what a
real client has to tolerate.

## Success Metrics

**Real check, not simulated**: built the package for real (`npm run build`) and spawned
`node packages/lsp/dist/index.js` as a real child process, speaking raw Content-Length-framed
JSON-RPC over its actual stdio, against `benchmarks/projects/sample-next-app` — a real project
already synced on this machine (4 files, 7 functions, 3 classes, 4 interfaces, 27 edges).

- `initialize` → real capabilities object, all seven providers advertised.
- `workspace/symbol` (empty query) → 23 real symbols (`authMiddleware`, `UserRepository`, `User`,
  ... ) with correct `SymbolKind`s and real file URIs.
- `initialized` → asynchronously published a real diagnostic:
  `"Unreachable file — no other file imports src/api/routes.ts"` on the correct file URI — a
  genuine, correct dead-code finding, not a fixture.
- `textDocument/documentSymbol` on `middleware.ts` → the 3 real functions it declares.
- `textDocument/hover` on `authMiddleware` → real formatted context: type, file, group, and
  `"Used by (1): • middleware.ts"`.
- `textDocument/codeLens` on the same file → `"1 dependent · complexity 3"` for `authMiddleware`
  (real fan-in count, real cyclomatic complexity from the graph), each wired to
  `nodum.traceImpact` with the real node id as its argument.
- `textDocument/references` → the one real node whose `calls` edge targets `authMiddleware`.
- `workspace/executeCommand` (`nodum.deadCode`) → `"1 unreachable file(s): • src/api/routes.ts"`,
  matching the diagnostic above exactly, plus a real `window/showMessageRequest` shown to the
  (simulated) client.
- `shutdown` → `null` result, clean process exit code 0.

Every capability this spec's Scope table lists was exercised against real graph data from a real
synced project, not a fixture — satisfying the "manual verification against at least one real LSP
client" bar this spec's Success Metrics originally asked for (a raw JSON-RPC client speaking the
identical wire protocol a real IDE would, rather than VS Code's own extension host, which spec 073
is the more natural place to verify against once a real VSIX packaging exists to launch).

`npx eslint packages --ext .ts` — 486 → 528 problems (245 → 264 errors, 241 → 264 warnings); the
full +42 delta is attributable to `packages/lsp`'s own new files, following the same
non-null-assertion-in-tests pattern `packages/mcp/src/index.test.ts` already established (20 of
its own), not a new category of issue.

## Related

Depends on: spec 071 (query layer), spec 060 (the `ensureLiftoffOnly` requirement this inherits).
Blocks: spec 073 (per-IDE shims wrap this server).
