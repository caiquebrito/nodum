import * as vscode from "vscode";

/** `nodum-lsp` isn't published to npm yet (spec 072) — no global-install
 * convention to auto-discover a bundled copy from, so this resolves purely
 * from PATH by default, with an explicit setting for anyone who built it
 * from source into a non-PATH location. See docs/guides/LSP-SETUP.md.
 *
 * Kept in its own module, separate from extension.ts, so it can be unit
 * tested without transitively pulling in vscode-languageclient — that
 * package's own top-level `require('vscode')` isn't interceptable by
 * `vi.mock("vscode", ...)` the way a direct import is (confirmed: the same
 * test failed with a real `Cannot find module 'vscode'` when this lived in
 * extension.ts). */
export function resolveServerCommand(): string {
  const configured = vscode.workspace.getConfiguration("nodum").get<string>("serverPath");
  return configured && configured.trim().length > 0 ? configured : "nodum-lsp";
}
