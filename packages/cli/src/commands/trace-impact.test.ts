import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graph = {
  project: "proj",
  stats: { files: 3, functions: 0, classes: 0, interfaces: 0, edges: 2 },
  nodes: [
    { id: "a", label: "a.ts", type: "file", file: "a.ts", group: "other" },
    { id: "b", label: "b.ts", type: "file", file: "b.ts", group: "other" },
    { id: "c", label: "c.ts", type: "file", file: "c.ts", group: "other" },
  ],
  edges: [
    { source: "a", target: "b", relation: "imports" },
    { source: "b", target: "c", relation: "imports" },
  ],
};

describe("traceImpactCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    readFileMock.mockResolvedValue(JSON.stringify(graph));
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await traceImpactCommand("proj", "c", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted, distance-grouped list", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await traceImpactCommand("proj", "c", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("2 files");
    expect(allLogs).toContain("1 hop");
    expect(allLogs).toContain("2 hops");
    expect(allLogs).toContain("b.ts");
    expect(allLogs).toContain("a.ts");
  });

  it("prints a clear message when nothing depends on the target", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await traceImpactCommand("proj", "a", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No files depend on");
  });

  it("--max-depth caps the reported hops", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await traceImpactCommand("proj", "c", "/tmp/.nodum", { json: true, maxDepth: 1 });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toEqual([{ nodeId: "b", file: "b.ts", distance: 1 }]);
  });

  it("--json prints the raw ImpactedFile[] array", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await traceImpactCommand("proj", "c", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.sort((a: any, b: any) => a.distance - b.distance)).toEqual([
      { nodeId: "b", file: "b.ts", distance: 1 },
      { nodeId: "a", file: "a.ts", distance: 2 },
    ]);
  });

  it("throws a clear error for a nonexistent node id", async () => {
    const { traceImpactCommand } = await import("./trace-impact.js");
    await expect(traceImpactCommand("proj", "nonexistent", "/tmp/.nodum", {})).rejects.toThrow(
      "Node not found: nonexistent",
    );
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { traceImpactCommand } = await import("./trace-impact.js");

    await expect(traceImpactCommand("unsynced-proj", "a", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
