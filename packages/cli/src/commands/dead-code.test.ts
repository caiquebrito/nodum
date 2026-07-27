import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graphWithOrphan = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "a", label: "index.ts", type: "file", file: "src/index.ts", group: "other" },
    { id: "b", label: "orphan.ts", type: "file", file: "src/orphan.ts", group: "other" },
  ],
  edges: [],
};

const fullyReachableGraph = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    { id: "a", label: "index.ts", type: "file", file: "src/index.ts", group: "other" },
    { id: "b", label: "used.ts", type: "file", file: "src/used.ts", group: "other" },
  ],
  edges: [{ source: "a", target: "b", relation: "imports" }],
};

describe("deadCodeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithOrphan));
    const { deadCodeCommand } = await import("./dead-code.js");
    await deadCodeCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted list of unreachable files", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithOrphan));
    const { deadCodeCommand } = await import("./dead-code.js");
    await deadCodeCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Unreachable files: 1 found");
    expect(allLogs).toContain("src/orphan.ts");
    expect(allLogs).not.toContain("src/index.ts");
  });

  it("prints a clear 'none found' message when everything is reachable", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(fullyReachableGraph));
    const { deadCodeCommand } = await import("./dead-code.js");
    await deadCodeCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No unreachable files found");
  });

  it("--json prints the raw UnreachableFile[] array", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithOrphan));
    const { deadCodeCommand } = await import("./dead-code.js");
    await deadCodeCommand("proj", "/tmp/.nodum", { json: true });

    const logged = (console.log as any).mock.calls[0][0];
    const parsed = JSON.parse(logged);
    expect(parsed).toEqual([{ nodeId: "b", file: "src/orphan.ts" }]);
  });

  it("--entry merges custom patterns with the built-in defaults", async () => {
    const graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        { id: "a", label: "home.tsx", type: "file", file: "src/pages/home.tsx", group: "other" },
        { id: "b", label: "orphan.ts", type: "file", file: "src/orphan.ts", group: "other" },
      ],
      edges: [],
    };
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { deadCodeCommand } = await import("./dead-code.js");
    await deadCodeCommand("proj", "/tmp/.nodum", { json: true, entry: "src/pages/**" });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toEqual([{ nodeId: "b", file: "src/orphan.ts" }]);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { deadCodeCommand } = await import("./dead-code.js");

    await expect(deadCodeCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
