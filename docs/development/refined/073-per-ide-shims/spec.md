# 073 — Per-IDE shims

## Status: refined — not started

Fully designed, not yet branched. Depends on spec 072 (the LSP server this packages).

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
and surface connection status. No original logic beyond that.

## Acceptance criteria

- [ ] VS Code extension: installs, connects to `nodum-lsp`, shows hover/diagnostics for a synced
      project.
- [ ] JetBrains plugin: same, verified in at least one JetBrains IDE (IntelliJ or Android Studio).
- [ ] Neovim/Helix/Zed config recipes documented and verified against at least one of the three.
- [ ] Visual Studio shim: scoped and either delivered or explicitly re-deferred with a stated
      reason, once its real packaging cost is known.

## Test plan

Manual verification per IDE (this is packaging, not logic — the logic is already tested in spec
072). Each shim's "test" is: install it in a real instance of that IDE, open a synced project,
confirm hover/diagnostics/workspace-symbol work.

## Success Metrics

At minimum: VS Code extension published (even unlisted/private initially) and JetBrains plugin
built and manually verified in Android Studio specifically, since that's the concrete IDE named
in the original ask this whole arc responds to.

## Related

Depends on: spec 072. Sibling to spec 074 (Xcode), which is expected to stay deferred rather than
delivered in this pass.
