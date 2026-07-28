import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graphWithScores = {
  project: "proj",
  stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    { id: "a", label: "a.ts", type: "file", file: "a.ts", group: "other" },
    { id: "a__f", label: "f", type: "function", file: "a.ts", group: "other", complexity: 8 },
    { id: "b", label: "b.ts", type: "file", file: "b.ts", group: "other" },
    { id: "b__f", label: "f", type: "function", file: "b.ts", group: "other", complexity: 3 },
  ],
  edges: [{ source: "b", target: "a", relation: "imports" }],
};

const graphNoScores = {
  project: "proj",
  stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0 },
  nodes: [{ id: "a", label: "a.ts", type: "file", file: "a.ts", group: "other" }],
  edges: [],
};

describe("bottlenecksCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphNoScores));
    const { bottlenecksCommand } = await import("./bottlenecks.js");
    await bottlenecksCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted ranked list", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithScores));
    const { bottlenecksCommand } = await import("./bottlenecks.js");
    await bottlenecksCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Bottlenecks");
    expect(allLogs).toContain("a.ts");
    expect(allLogs).toContain("complexity=8");
  });

  it("prints a clear 'none found' message when no function is scored", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphNoScores));
    const { bottlenecksCommand } = await import("./bottlenecks.js");
    await bottlenecksCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No scored functions found");
  });

  it("--limit caps the output", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithScores));
    const { bottlenecksCommand } = await import("./bottlenecks.js");
    await bottlenecksCommand("proj", "/tmp/.nodum", { json: true, limit: 1 });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
  });

  it("--json prints the raw Bottleneck[] array", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithScores));
    const { bottlenecksCommand } = await import("./bottlenecks.js");
    await bottlenecksCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed[0]).toMatchObject({ file: "a.ts", maxComplexity: 8, dependentCount: 1 });
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { bottlenecksCommand } = await import("./bottlenecks.js");

    await expect(bottlenecksCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
