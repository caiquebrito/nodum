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

describe("duplicatesCommand — fuzzy mode (spec 052)", () => {
  const sig = (values: number[]) => values.map(v => v.toString(16).padStart(4, "0")).join("");
  const IDENTICAL = sig(Array.from({ length: 32 }, (_, i) => 1000 + i));

  const graphWithNearDuplicates = {
    project: "proj",
    stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 0 },
    nodes: [
      { id: "a", label: "validateUserInput", type: "function", file: "a.ts", group: "other", similaritySignature: IDENTICAL },
      { id: "b", label: "validateOrderInput", type: "function", file: "b.ts", group: "other", similaritySignature: IDENTICAL },
    ],
    edges: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("groups near-duplicates instead of exact matches when --fuzzy is passed", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithNearDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", { fuzzy: true });

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Near-duplicate groups: 1 found");
    expect(allLogs).toContain("validateUserInput");
    expect(allLogs).toContain("validateOrderInput");
  });

  it("--fuzzy --json prints the raw DetectNearDuplicatesResult", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithNearDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", { fuzzy: true, json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].nodes.map((n: { nodeId: string }) => n.nodeId).sort()).toEqual(["a", "b"]);
  });

  it("--fuzzy prints a clear 'none found' message including the effective threshold", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphNoDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", { fuzzy: true });

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No near-duplicate groups found");
    expect(allLogs).toContain("threshold");
  });

  it("--fuzzy respects --threshold and --limit", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graphWithNearDuplicates));
    const { duplicatesCommand } = await import("./duplicates.js");
    await duplicatesCommand("proj", "/tmp/.nodum", { fuzzy: true, threshold: 0.99, limit: 1 });

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("threshold 0.99");
  });
});
