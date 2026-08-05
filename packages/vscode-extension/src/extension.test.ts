import { describe, it, expect, vi, beforeEach } from "vitest";

// The `vscode` module only exists at runtime inside a real VS Code extension
// host — there's no npm package providing it (`@types/vscode` is types
// only). resolveServerCommand() lives in its own module (config.ts) rather
// than extension.ts specifically so this test doesn't transitively pull in
// vscode-languageclient — that package's own top-level `require('vscode')`
// isn't interceptable by `vi.mock` the way a direct import is (confirmed by
// reproducing the resulting `Cannot find module 'vscode'` failure before
// this split). Everything else in extension.ts (LanguageClient lifecycle,
// command registration, status bar) is a thin, direct call into the real
// `vscode` API with no independent logic of its own; real verification for
// that needs a real extension host (`@vscode/test-electron` or manual
// install), out of reach in this environment — see spec 073's writeup for
// what was and wasn't verified.
const getConfigurationMock = vi.fn();
vi.mock("vscode", () => ({
  workspace: { getConfiguration: getConfigurationMock },
}));

const { resolveServerCommand } = await import("./config.js");

describe("resolveServerCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to 'nodum-lsp' (resolved from PATH) when no override is configured", () => {
    getConfigurationMock.mockReturnValue({ get: () => "" });
    expect(resolveServerCommand()).toBe("nodum-lsp");
  });

  it("defaults to 'nodum-lsp' when the setting is unset entirely", () => {
    getConfigurationMock.mockReturnValue({ get: () => undefined });
    expect(resolveServerCommand()).toBe("nodum-lsp");
  });

  it("uses the configured nodum.serverPath override when set", () => {
    getConfigurationMock.mockReturnValue({ get: () => "/opt/nodum/bin/nodum-lsp" });
    expect(resolveServerCommand()).toBe("/opt/nodum/bin/nodum-lsp");
  });

  it("treats a whitespace-only override as unset", () => {
    getConfigurationMock.mockReturnValue({ get: () => "   " });
    expect(resolveServerCommand()).toBe("nodum-lsp");
  });

  it("reads from the 'nodum' configuration section", () => {
    getConfigurationMock.mockReturnValue({ get: () => "" });
    resolveServerCommand();
    expect(getConfigurationMock).toHaveBeenCalledWith("nodum");
  });
});
