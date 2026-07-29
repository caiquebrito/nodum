import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graphWithDuplicates = {
  project: "proj",
  stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "a", label: "validateUserInput", type: "function", file: "a.ts", group: "other", duplicateHash: "h1" },
    { id: "b", label: "validateOrderInput", type: "function", file: "b.ts", group: "other", duplicateHash: "h1" },
  ],
  edges: [],
};

describe("similarCodeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    readFileMock.mockResolvedValue(JSON.stringify(graphWithDuplicates));
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    const { similarCodeCommand } = await import("./similar-code.js");
    await similarCodeCommand("proj", "a", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted match list", async () => {
    const { similarCodeCommand } = await import("./similar-code.js");
    await similarCodeCommand("proj", "a", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("validateUserInput");
    expect(allLogs).toContain("validateOrderInput");
  });

  it("prints a clear 'no similar code' message when there's no match", async () => {
    const { similarCodeCommand } = await import("./similar-code.js");
    await similarCodeCommand("proj", "nonexistent", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No similar code found");
  });

  it("--json prints the raw SimilarCodeResult object", async () => {
    const { similarCodeCommand } = await import("./similar-code.js");
    await similarCodeCommand("proj", "a", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toEqual({
      nodeId: "a",
      threshold: 0.65,
      matches: [{ nodeId: "b", label: "validateOrderInput", file: "b.ts", similarity: 1, kind: "exact" }],
    });
  });

  it("--threshold and --limit are threaded through to findSimilarCode", async () => {
    const { similarCodeCommand } = await import("./similar-code.js");
    await similarCodeCommand("proj", "a", "/tmp/.nodum", { json: true, threshold: 0.5, limit: 1 });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.threshold).toBe(0.5);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { similarCodeCommand } = await import("./similar-code.js");

    await expect(similarCodeCommand("unsynced-proj", "a", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
