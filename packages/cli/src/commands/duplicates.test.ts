import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graphWithDuplicates = {
  project: "proj",
  stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "a", label: "validateUserInput", type: "function", file: "a.ts", group: "other", duplicateHash: "h1" },
    { id: "b", label: "validateOrderInput", type: "function", file: "b.ts", group: "other", duplicateHash: "h1" },
  ],
  edges: [],
};

const graphNoDuplicates = {
  project: "proj",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [{ id: "a", label: "foo", type: "function", file: "a.ts", group: "other" }],
  edges: [],
};

describe("duplicatesCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphNoDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted grouped list", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Duplicate groups: 1 found");
    expect(allLogs).toContain("validateUserInput");
    expect(allLogs).toContain("validateOrderInput");
  });

  it("prints a clear 'none found' message when there are no duplicates", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphNoDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No duplicate groups found");
  });

  it("--json prints the raw DuplicateGroup[] array", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nodes.map((n: { nodeId: string }) => n.nodeId).sort()).toEqual(["a", "b"]);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { duplicatesCommand } = await import("./duplicates.js");

    await expect(duplicatesCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
