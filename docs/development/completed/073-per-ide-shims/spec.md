# 073 — Per-IDE shims

## Status: done (scoped)

Scoped to VS Code + the Neovim/Helix/Zed docs page this pass, per explicit direction — JetBrains/
Android Studio and Visual Studio are deliberately deferred, not attempted and abandoned; see
"Deferred" below. This mirrors the spec's own posture toward Visual Studio ("scope realistically
once the VS Code shim's actual effort is known") extended to JetBrains too, once it became clear
real in-IDE verification for either isn't possible in this environment.

**`packages/vscode-extension`** (`nodum-vscode`, private/unpublished — not submitted to the VS
Code Marketplace this pass) wraps `vscode-languageclient` around `nodum-lsp`, resolved from `PATH`
by default (spec 072 doesn't publish `nodum-lsp` to npm, so there's no global-install convention
to auto-discover a bundled copy from yet — an explicit `nodum.serverPath` setting overrides this
for anyone who built it into a non-`PATH` location). Three commands (`nodum.sync`,
`nodum.deadCode`, `nodum.restartServer`), a status bar connection indicator, and a `nodum.trace.server`
setting for LSP-traffic debugging — genuinely thin, no query/analysis logic of its own, all of
that stays in `nodum-lsp`.

**Three real bugs found by actually building and packaging this, not by writing code that looked
right:**

1. **A deep import that type-checks but crashes at real runtime.** `vscode-languageclient`'s
   package.json declares only `.`/`./node`/`./browser` in its `exports` map. An initial deep
   import (`vscode-languageclient/lib/node/main`) satisfied TypeScript's classic `"node"` module
   resolution, but a direct `node -e "require(...)"` reproduction confirmed real Node itself
   throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for that exact path — this would have shipped a
   VSIX that crashes on activation. Fixed by switching this package to `module`/`moduleResolution:
   "NodeNext"` (not `"bundler"` — TS forbids pairing `"bundler"` with a non-ESM `module`, and
   CommonJS output is a real VS Code extension-host requirement) and importing the properly
   declared `vscode-languageclient/node` subpath instead.
2. **`vi.mock("vscode", ...)` doesn't intercept a dependency's own transitive `require("vscode")`.**
   Vitest's mock only reliably applies to modules a test file imports directly; `vscode-languageclient`'s
   own top-level `require("vscode")` (needed for base classes like `ProtocolCompletionItem`) bypassed
   it, surfacing as a real `Cannot find module 'vscode'` failure the first time `extension.test.ts`
   imported `extension.ts` directly. Fixed by extracting the one genuinely pure-logic function
   (`resolveServerCommand`, the `nodum.serverPath`-override-vs.-PATH-default decision) into its own
   `config.ts` with zero dependency on `vscode-languageclient`, so testing it doesn't transitively
   pull that dependency in at all.
3. **`vsce package` walked the entire monorepo.** With no `files`/`.vscodeignore` config, `vsce`
   attempted its own dependency resolution against this package's `dependencies` field
   (`vscode-languageclient`) and, hitting npm workspaces' hoisted (not locally-present)
   `node_modules`, climbed parent directories and tried to bundle **1845 files, 36+ MB** —
   effectively the whole repo — before failing outright on an invalid relative path. Root-caused
   by reproducing it twice (once before adding a `files` allowlist, confirming that alone wasn't
   sufficient) before finding the actual fix: bundle `vscode-languageclient` directly into
   `dist/extension.js` via `esbuild` (`--external:vscode` — the one thing only the real extension
   host can provide, everything else inlined; no WASM/native-binary concerns here, unlike a
   hypothetical `nodum-lsp` bundle, since `vscode-languageclient` is pure protocol-implementation
   JS) and pass `vsce package --no-dependencies`, telling it not to attempt its own resolution at
   all. **Real check**: the resulting `.vsix` was unzipped and inspected directly — 5 files,
   139.74 KB, containing exactly `package.json`/`README.md`/`dist/extension.js`; a `grep` over
   every `require(...)` call in the bundled `extension.js` confirmed only `"vscode"` and real Node
   builtins (`fs`, `path`, `child_process`, ...) remain — no dangling `node_modules` reference that
   would fail once installed on a real machine outside this monorepo.

**`docs/guides/LSP-SETUP.md`** — Neovim (both the 0.11+ built-in `vim.lsp.config` API and
`nvim-lspconfig` for older versions) and Helix config recipes, both straightforward since both
editors accept an arbitrary `cmd`. Zed's recipe is explicitly flagged as **unverified** — Zed's
LSP integration appears to be extension-API-oriented rather than a bare `settings.json` entry in
current versions, and confirming that needs a real Zed instance this environment doesn't have; the
doc says so directly rather than presenting an unverified guess as confirmed working.

## What was and wasn't verified

**Verified for real**: `packages/vscode-extension` builds (`tsc --noEmit` clean), its one
unit-testable function has real test coverage (5 tests), the production bundle is genuinely
self-contained (confirmed via `require.resolve` and a `require(...)` audit of the actual bundled
output, not assumed), and the final `.vsix` packages cleanly and was inspected file-by-file.

**Not verified, and explicitly out of reach in this environment**: actually installing the
extension in a running VS Code instance and confirming hover/diagnostics/workspace-symbol work
end to end — this environment has no GUI to click through. This is the same category of gap the
original spec's own Test Plan anticipated ("install it in a real instance of that IDE") but
assumed a human tester; that step is still owed by whoever installs the packaged `.vsix` next.

## Deferred, not delivered this pass

- **JetBrains/Android Studio plugin** — explicitly out of scope for this pass per direction
  received; genuinely needs the same kind of real-IDE click-through verification the VS Code shim
  can't get here either, on top of being a materially different, JetBrains-platform-specific
  codebase (Kotlin/Java plugin, LSP4IJ or equivalent) this pass didn't start.
- **Visual Studio shim** — the original spec already named this "scope realistically once the VS
  Code shim's actual effort is known"; now that it's known (real, non-trivial packaging
  complications even for the more standard VS Code case), Visual Studio's own less-uniform
  extension APIs stay deferred rather than attempted blind.
- **VS Code Marketplace publishing** — the extension is packaged (`.vsix` produced) but not
  submitted; that's a real, externally-visible action requiring explicit authorization not sought
  this pass.

## Goal

Thin, marketplace-distributable packaging around `nodum-lsp` for the IDEs that need more than a
config recipe: VS Code (and by extension Cursor/Windsurf), the JetBrains family (including
Android Studio), and Visual Studio.

## Why now

Spec 072 makes the LSP server real; this spec is what makes it *installable* from where
developers actually look (a marketplace), rather than requiring hand-written `.mcp.json`-style
config for every IDE. This is the concrete "reach Android Studio and Visual Studio" deliverable
the whole arc (071-074) exists for.

## Scope

Thin packaging only — no query/analysis logic lives in any of these, all of it stays in
`nodum-lsp` (spec 072):

- **VS Code** — a VSIX extension wrapping `vscode-languageclient` pointed at `nodum-lsp`
  (~200 lines: activation, client startup, status bar indicator). Publishing this also covers
  Cursor and Windsurf, both VS Code forks that support the same extension format.
- **JetBrains / Android Studio** — a plugin using the JetBrains platform's built-in LSP4IJ (or
  equivalent) LSP-client API, pointed at `nodum-lsp`. One plugin artifact published to the
  JetBrains Marketplace reaches IntelliJ IDEA, Android Studio, PyCharm, GoLand, and WebStorm
  simultaneously, since they share the platform's LSP support.
- **Neovim / Helix / Zed** — no code: a documentation page (`docs/guides/` — name TBD, e.g.
  `LSP-SETUP.md`) with copy-pasteable config snippets for each editor's native LSP-client
  configuration pointed at `nodum-lsp`.
- **Visual Studio** (the JetBrains-adjacent but distinct Microsoft IDE, not VS Code) — a VSIX
  using VS's LSP extension support. Heavier packaging than VS Code's; scope realistically once
  the VS Code shim's actual effort is known, since VS's extension APIs are less uniform.

## Out of scope

- Xcode (spec 074, expected to stay deferred).
- Any IDE-specific UI beyond "connect to the language server and show its diagnostics/hover/etc.
  through the IDE's native LSP UI" — no custom nodum-branded panels, no bespoke visualizations.
  The 3D viewer (`packages/server`/`packages/viewer`) already exists for that; these shims are
  about meeting developers where they work, not rebuilding the viewer inside every IDE.

## Design

Each shim's job is exactly: locate/launch `nodum-lsp` (bundled or resolved from `PATH`/npm global
install — decide per-IDE based on that platform's convention for bundling a language server
binary; VS Code extensions commonly bundle a Node-based LSP server directly, JetBrains plugins
more commonly shell out to a system-installed binary), wire it to the IDE's native LSP client,
and surface connection status. No original logic beyond that. **Resolved for VS Code specifically**:
`nodum-lsp` itself is resolved from `PATH` (not bundled) — since it's not published to npm yet,
there's no clean global-install story to bundle against; `vscode-languageclient` (the client
library) is what gets bundled into the extension, via esbuild, for the unrelated reason that
npm-workspaces' `node_modules` hoisting makes shipping unbundled dependencies in a VSIX fragile.

## Acceptance criteria

- [x] VS Code extension: builds, bundles, and packages into a real, inspected `.vsix`. **Not**
      verified installed/connected/showing hover-diagnostics in a running VS Code — no GUI
      available in this environment; see "What was and wasn't verified" above.
- [ ] JetBrains plugin — deferred this pass (see "Deferred" above).
- [x] Neovim/Helix config recipes documented; Zed's is documented but explicitly flagged
      unverified (no Zed instance available to confirm against).
- [x] Visual Studio shim — explicitly re-deferred with a stated reason (see "Deferred" above),
      exactly the outcome the original spec allowed for.

## Test plan

`packages/vscode-extension/src/extension.test.ts` — 5 tests covering `resolveServerCommand`'s
PATH-default/override/whitespace-handling logic (the one piece of this package with independent
logic to unit test; everything else is a thin, direct call into the real `vscode` API — see
"What was and wasn't verified"). `npm run build && npm test --workspaces` green — 978 tests total
(5 new). Real, not simulated: a full `npm run package` run (`tsc` → `esbuild` bundle → `vsce
package --no-dependencies`) producing and then unzipping/inspecting the actual `.vsix`.

## Success Metrics

VS Code extension built and packaged (not yet published, even unlisted). JetBrains plugin
verified in Android Studio — deferred, not delivered this pass; see "Deferred" above for why, and
`docs/development/refined/` for tracking it as remaining LSP-arc work rather than silently
dropping it.

## Related

Depends on: spec 072. Sibling to spec 074 (Xcode), which is expected to stay deferred rather than
delivered in this pass.
