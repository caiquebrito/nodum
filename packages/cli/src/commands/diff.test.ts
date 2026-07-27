import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
const existsSyncMock = vi.fn();
const statSyncMock = vi.fn();

vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  statSync: (...args: unknown[]) => statSyncMock(...args),
}));

const graphA = {
  project: "proj",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [{ id: "n1", label: "foo", type: "function", file: "a.ts", group: "other" }],
  edges: [],
};
const graphB = {
  project: "proj",
  stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "n1", label: "foo", type: "function", file: "a.ts", group: "other" },
    { id: "n2", label: "bar", type: "function", file: "a.ts", group: "other" },
  ],
  edges: [],
};

describe("diffCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    existsSyncMock.mockReturnValue(false);
  });

  it("resolves two file-path arguments directly via readFile, without touching nodumDataDir", async () => {
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isFile: () => true });
    readFileMock.mockImplementation((path: string) => {
      if (path === "/abs/a.json") return Promise.resolve(JSON.stringify(graphA));
      if (path === "/abs/b.json") return Promise.resolve(JSON.stringify(graphB));
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });
    const { diffCommand } = await import("./diff.js");
    await diffCommand("/abs/a.json", "/abs/b.json", "/tmp/.nodum", {});

    expect(readFileMock).toHaveBeenCalledWith("/abs/a.json", "utf-8");
    expect(readFileMock).toHaveBeenCalledWith("/abs/b.json", "utf-8");
    const calledPaths = readFileMock.mock.calls.map(c => c[0]);
    expect(calledPaths.some(p => p.includes(".nodum"))).toBe(false);
  });

  it("resolves two project-name arguments via the nodumDataDir convention", async () => {
    existsSyncMock.mockReturnValue(false); // neither arg is an existing file
    readFileMock.mockImplementation((path: string) => {
      if (path === "/tmp/.nodum/proj-a/graph/graph.json") return Promise.resolve(JSON.stringify(graphA));
      if (path === "/tmp/.nodum/proj-b/graph/graph.json") return Promise.resolve(JSON.stringify(graphB));
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });

    const { diffCommand } = await import("./diff.js");
    await diffCommand("proj-a", "proj-b", "/tmp/.nodum", {});

    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj-a/graph/graph.json", "utf-8");
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj-b/graph/graph.json", "utf-8");
  });

  it("throws naming the failing argument when it can't be resolved as a file or a synced project", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockRejectedValue(new Error("ENOENT"));

    const { diffCommand } = await import("./diff.js");

    await expect(diffCommand("nonexistent", "proj-b", "/tmp/.nodum", {})).rejects.toThrow('"nonexistent"');
  });

  it("--json prints valid JSON matching the GraphDiff shape", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockImplementation((path: string) => {
      if (path.includes("proj-a")) return Promise.resolve(JSON.stringify(graphA));
      return Promise.resolve(JSON.stringify(graphB));
    });

    const { diffCommand } = await import("./diff.js");
    await diffCommand("proj-a", "proj-b", "/tmp/.nodum", { json: true });

    const logged = (console.log as any).mock.calls[0][0];
    const parsed = JSON.parse(logged);
    expect(parsed.nodes.added).toHaveLength(1);
    expect(parsed.statsDelta.functions).toBe(1);
  });

  it("without --json prints a formatted summary", async () => {
    existsSyncMock.mockReturnValue(false);
    readFileMock.mockImplementation((path: string) => {
      if (path.includes("proj-a")) return Promise.resolve(JSON.stringify(graphA));
      return Promise.resolve(JSON.stringify(graphB));
    });

    const { diffCommand } = await import("./diff.js");
    await diffCommand("proj-a", "proj-b", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Graph diff: proj-a → proj-b");
    expect(allLogs).toContain("Added nodes (1)");
  });
});
