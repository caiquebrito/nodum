import { describe, it, expect, vi, beforeEach } from "vitest";

const { handleTraceImpactMock, handleFindSimilarCodeMock } = vi.hoisted(() => ({
  handleTraceImpactMock: vi.fn(),
  handleFindSimilarCodeMock: vi.fn(),
}));
vi.mock("@caiquebrito/nodum-query", () => ({
  handleTraceImpact: handleTraceImpactMock,
  handleFindSimilarCode: handleFindSimilarCodeMock,
}));

const { detectUnreachableFilesMock, findManifestEntryFilesMock, findCiInvokedFilesMock } = vi.hoisted(() => ({
  detectUnreachableFilesMock: vi.fn(),
  findManifestEntryFilesMock: vi.fn(async () => []),
  findCiInvokedFilesMock: vi.fn(async () => []),
}));
vi.mock("@caiquebrito/nodum-core", () => ({
  detectUnreachableFiles: detectUnreachableFilesMock,
  findManifestEntryFiles: findManifestEntryFilesMock,
  findCiInvokedFiles: findCiInvokedFilesMock,
}));

const { executeNodumCommand } = await import("./commands.js");

function fakeProject(overrides: Record<string, unknown> = {}) {
  return {
    projectName: "proj",
    rootPath: "/proj",
    ensureGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    resync: vi.fn(async () => ({ project: "proj", stats: { files: 3, edges: 5 }, nodes: [], edges: [] })),
    ...overrides,
  } as any;
}

describe("executeNodumCommand", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("nodum.sync resyncs the project and summarizes the result", async () => {
    const project = fakeProject();
    const result = await executeNodumCommand("nodum.sync", [], project);
    expect(project.resync).toHaveBeenCalled();
    expect(result).toBe("Synced proj: 3 files, 5 dependencies");
  });

  it("nodum.traceImpact forwards the node id argument to handleTraceImpact", async () => {
    handleTraceImpactMock.mockResolvedValue({ content: [{ type: "text", text: "impact text" }] });
    const project = fakeProject();
    const result = await executeNodumCommand("nodum.traceImpact", ["node-1"], project);
    expect(handleTraceImpactMock).toHaveBeenCalledWith("proj", "node-1");
    expect(result).toBe("impact text");
  });

  it("nodum.findSimilar forwards the node id argument to handleFindSimilarCode", async () => {
    handleFindSimilarCodeMock.mockResolvedValue({ content: [{ type: "text", text: "similar text" }] });
    const project = fakeProject();
    const result = await executeNodumCommand("nodum.findSimilar", ["node-2"], project);
    expect(handleFindSimilarCodeMock).toHaveBeenCalledWith("proj", "node-2");
    expect(result).toBe("similar text");
  });

  it("nodum.deadCode reports 'No dead code found' when detectUnreachableFiles returns nothing", async () => {
    detectUnreachableFilesMock.mockReturnValue([]);
    const project = fakeProject();
    const result = await executeNodumCommand("nodum.deadCode", [], project);
    expect(result).toBe("No dead code found");
  });

  it("nodum.deadCode lists each unreachable file", async () => {
    detectUnreachableFilesMock.mockReturnValue([{ nodeId: "a", file: "legacy.ts" }]);
    const project = fakeProject();
    const result = await executeNodumCommand("nodum.deadCode", [], project);
    expect(result).toBe("1 unreachable file(s):\n  • legacy.ts");
  });

  it("throws on an unknown command", async () => {
    const project = fakeProject();
    await expect(executeNodumCommand("nodum.bogus", [], project)).rejects.toThrow("Unknown command");
  });
});
