import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const acyclicGraph = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    { id: "a", label: "a", type: "file", file: "a.ts", group: "other" },
    { id: "b", label: "b", type: "file", file: "b.ts", group: "other" },
  ],
  edges: [{ source: "a", target: "b", relation: "imports" }],
};

const cyclicGraph = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 2 },
  nodes: [
    { id: "a", label: "a", type: "file", file: "a.ts", group: "other" },
    { id: "b", label: "b", type: "file", file: "b.ts", group: "other" },
  ],
  edges: [
    { source: "a", target: "b", relation: "imports" },
    { source: "b", target: "a", relation: "imports" },
  ],
};

describe("cyclesCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(acyclicGraph));
    const { cyclesCommand } = await import("./cycles.js");
    await cyclesCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted summary listing each cycle's file chain", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(cyclicGraph));
    const { cyclesCommand } = await import("./cycles.js");
    await cyclesCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Dependency cycles: 1 found");
    expect(allLogs).toContain("a.ts");
    expect(allLogs).toContain("b.ts");
  });

  it("prints a clear 'no cycles' message when the project is acyclic", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(acyclicGraph));
    const { cyclesCommand } = await import("./cycles.js");
    await cyclesCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No circular imports found");
  });

  it("--json prints the raw Cycle[] array", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(cyclicGraph));
    const { cyclesCommand } = await import("./cycles.js");
    await cyclesCommand("proj", "/tmp/.nodum", { json: true });

    const logged = (console.log as any).mock.calls[0][0];
    const parsed = JSON.parse(logged);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].files.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { cyclesCommand } = await import("./cycles.js");

    await expect(cyclesCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
