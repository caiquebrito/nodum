import { describe, it, expect, vi, beforeEach } from "vitest";

// server.test.ts verifies wiring/dispatch only — each capability module
// (symbols.ts, hover.ts, etc.) has its own test file covering its actual
// logic. A fake Connection captures every registered handler the same way
// spec 057's mcp/index.test.ts captures registerTool callbacks.
const { ensureGraphMock, resyncMock, ProjectContextMock } = vi.hoisted(() => ({
  ensureGraphMock: vi.fn(async () => ({ nodes: [], edges: [] })),
  resyncMock: vi.fn(async () => ({ nodes: [], edges: [] })),
  ProjectContextMock: vi.fn(),
}));
vi.mock("./project.js", () => ({
  ProjectContext: ProjectContextMock.mockImplementation(function (this: any, rootPath: string) {
    this.rootPath = rootPath;
    this.projectName = rootPath.split("/").pop();
    this.ensureGraph = ensureGraphMock;
    this.resync = resyncMock;
  }),
}));

const {
  computeDiagnosticsMock,
  workspaceSymbolsMock,
  documentSymbolsMock,
  hoverAtMock,
  codeLensesForFileMock,
  referencesAtMock,
  executeNodumCommandMock,
} = vi.hoisted(() => ({
  computeDiagnosticsMock: vi.fn(async () => new Map()),
  workspaceSymbolsMock: vi.fn(() => ["ws-symbol"]),
  documentSymbolsMock: vi.fn(() => ["doc-symbol"]),
  hoverAtMock: vi.fn(async () => ({ contents: "hover" })),
  codeLensesForFileMock: vi.fn(() => ["lens"]),
  referencesAtMock: vi.fn(() => ["ref"]),
  executeNodumCommandMock: vi.fn(async () => "command result"),
}));
vi.mock("./diagnostics.js", () => ({ computeDiagnostics: computeDiagnosticsMock }));
vi.mock("./symbols.js", () => ({ workspaceSymbols: workspaceSymbolsMock, documentSymbols: documentSymbolsMock }));
vi.mock("./hover.js", () => ({ hoverAt: hoverAtMock }));
vi.mock("./code-lens.js", () => ({ codeLensesForFile: codeLensesForFileMock }));
vi.mock("./references.js", () => ({ referencesAt: referencesAtMock }));
vi.mock("./commands.js", () => ({
  executeNodumCommand: executeNodumCommandMock,
  NODUM_COMMANDS: ["nodum.sync", "nodum.traceImpact", "nodum.findSimilar", "nodum.deadCode"],
}));

const { createServer } = await import("./server.js");

function fakeConnection() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const on = (name: string) => (handler: (...args: any[]) => any) => handlers.set(name, handler);
  return {
    handlers,
    onInitialize: on("initialize"),
    onInitialized: on("initialized"),
    onHover: on("hover"),
    onWorkspaceSymbol: on("workspaceSymbol"),
    onDocumentSymbol: on("documentSymbol"),
    onCodeLens: on("codeLens"),
    onReferences: on("references"),
    onExecuteCommand: on("executeCommand"),
    onDidChangeWatchedFiles: on("didChangeWatchedFiles"),
    onShutdown: on("shutdown"),
    sendDiagnostics: vi.fn(async () => {}),
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() },
    window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
  };
}

describe("createServer wiring", () => {
  let connection: ReturnType<typeof fakeConnection>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = fakeConnection();
    createServer(connection as any);
  });

  it("registers a ProjectContext from the first workspace folder on initialize", () => {
    const result = connection.handlers.get("initialize")!({
      workspaceFolders: [{ uri: "file:///proj", name: "proj" }],
      rootUri: null,
    });

    expect(ProjectContextMock).toHaveBeenCalledWith("/proj");
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.executeCommandProvider.commands).toContain("nodum.sync");
  });

  it("falls back to rootUri when no workspaceFolders are given", () => {
    connection.handlers.get("initialize")!({ workspaceFolders: null, rootUri: "file:///legacy-root" });
    expect(ProjectContextMock).toHaveBeenCalledWith("/legacy-root");
  });

  it("warns and leaves capabilities empty when neither is present", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: null, rootUri: null });
    expect(connection.console.warn).toHaveBeenCalled();

    const hover = await connection.handlers.get("hover")!({ textDocument: { uri: "file:///x.ts" }, position: { line: 0, character: 0 } });
    expect(hover).toBeNull();
  });

  it("dispatches hover through hoverAt with the resolved project and graph", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: [{ uri: "file:///proj" }] });
    const params = { textDocument: { uri: "file:///proj/a.ts" }, position: { line: 1, character: 0 } };

    const result = await connection.handlers.get("hover")!(params);

    expect(ensureGraphMock).toHaveBeenCalled();
    expect(hoverAtMock).toHaveBeenCalledWith("proj", "/proj", { nodes: [], edges: [] }, params.textDocument.uri, params.position);
    expect(result).toEqual({ contents: "hover" });
  });

  it("dispatches workspace/symbol, documentSymbol, codeLens, and references to their capability modules", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: [{ uri: "file:///proj" }] });

    expect(await connection.handlers.get("workspaceSymbol")!({ query: "auth" })).toEqual(["ws-symbol"]);
    expect(workspaceSymbolsMock).toHaveBeenCalledWith("/proj", { nodes: [], edges: [] }, "auth");

    expect(await connection.handlers.get("documentSymbol")!({ textDocument: { uri: "file:///proj/a.ts" } })).toEqual(["doc-symbol"]);
    expect(await connection.handlers.get("codeLens")!({ textDocument: { uri: "file:///proj/a.ts" } })).toEqual(["lens"]);

    const refParams = { textDocument: { uri: "file:///proj/a.ts" }, position: { line: 0, character: 0 }, context: { includeDeclaration: true } };
    expect(await connection.handlers.get("references")!(refParams)).toEqual(["ref"]);
    expect(referencesAtMock).toHaveBeenCalledWith("/proj", { nodes: [], edges: [] }, refParams.textDocument.uri, refParams.position, true);
  });

  it("executeCommand runs the command, shows the result, and re-publishes diagnostics only for nodum.sync", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: [{ uri: "file:///proj" }] });

    await connection.handlers.get("executeCommand")!({ command: "nodum.traceImpact", arguments: ["n1"] });
    expect(connection.window.showInformationMessage).toHaveBeenCalledWith("command result");
    expect(computeDiagnosticsMock).not.toHaveBeenCalled();

    await connection.handlers.get("executeCommand")!({ command: "nodum.sync", arguments: [] });
    expect(computeDiagnosticsMock).toHaveBeenCalled();
  });

  it("executeCommand shows an error message and returns null when the command throws", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: [{ uri: "file:///proj" }] });
    executeNodumCommandMock.mockRejectedValueOnce(new Error("boom"));

    const result = await connection.handlers.get("executeCommand")!({ command: "nodum.sync", arguments: [] });

    expect(result).toBeNull();
    expect(connection.window.showErrorMessage).toHaveBeenCalledWith("nodum: Error: boom");
  });

  it("onDidChangeWatchedFiles triggers an incremental resync and republishes diagnostics", async () => {
    connection.handlers.get("initialize")!({ workspaceFolders: [{ uri: "file:///proj" }] });

    connection.handlers.get("didChangeWatchedFiles")!({ changes: [] });
    // resync() runs fire-and-forget — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resyncMock).toHaveBeenCalled();
    expect(computeDiagnosticsMock).toHaveBeenCalled();
  });
});
