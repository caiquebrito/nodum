import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graph = {
  project: "proj",
  stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "a", label: "foo", type: "function", file: "a.ts", group: "other", complexity: 8 },
    { id: "b", label: "bar", type: "function", file: "a.ts", group: "other", complexity: 2 },
  ],
  edges: [],
};

describe("complexityCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { complexityCommand } = await import("./complexity.js");
    await complexityCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted ranking, most complex first", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { complexityCommand } = await import("./complexity.js");
    await complexityCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs.indexOf("foo")).toBeLessThan(allLogs.indexOf("bar"));
  });

  it("--threshold filters the ranking", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { complexityCommand } = await import("./complexity.js");
    await complexityCommand("proj", "/tmp/.nodum", { json: true, threshold: 5 });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nodeId).toBe("a");
  });

  it("--json prints the raw ComplexityRanking[] array", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { complexityCommand } = await import("./complexity.js");
    await complexityCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toEqual([
      { nodeId: "a", label: "foo", file: "a.ts", complexity: 8 },
      { nodeId: "b", label: "bar", file: "a.ts", complexity: 2 },
    ]);
  });

  it("prints a clear 'none found' message when no node has a complexity score", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ ...graph, nodes: graph.nodes.map(({ complexity, ...rest }) => rest) }),
    );
    const { complexityCommand } = await import("./complexity.js");
    await complexityCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No scored functions found");
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { complexityCommand } = await import("./complexity.js");

    await expect(complexityCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
