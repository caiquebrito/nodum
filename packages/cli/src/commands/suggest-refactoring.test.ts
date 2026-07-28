import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const cyclicGraph = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 2 },
  nodes: [
    { id: "a", label: "a.ts", type: "file", file: "a.ts", group: "ui" },
    { id: "b", label: "b.ts", type: "file", file: "b.ts", group: "repo" },
  ],
  edges: [
    { source: "a", target: "b", relation: "imports" },
    { source: "b", target: "a", relation: "imports" },
  ],
};

function mockFiles(nodumrc: object | null) {
  readFileMock.mockImplementation((path: string) => {
    if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(cyclicGraph));
    if (path.endsWith(".nodumrc.json")) {
      if (nodumrc === null) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(JSON.stringify(nodumrc));
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

describe("suggestRefactoringCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints a formatted, category-grouped list without architecture rules configured", async () => {
    mockFiles(null);
    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");
    await suggestRefactoringCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("CYCLE");
    expect(allLogs).not.toContain("ARCHITECTURE-VIOLATION");
  });

  it("includes architecture-violation suggestions when a .nodumrc.json rule exists", async () => {
    mockFiles({ architecture: { rules: [{ from: "ui", to: "repo" }] } });
    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");
    await suggestRefactoringCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("ARCHITECTURE-VIOLATION");
  });

  it("--json prints the raw RefactoringSuggestion[] array", async () => {
    mockFiles(null);
    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");
    await suggestRefactoringCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.some((s: any) => s.kind === "cycle")).toBe(true);
  });

  it("--complexity-threshold is passed through", async () => {
    const graphWithComplexFn = {
      ...cyclicGraph,
      nodes: [...cyclicGraph.nodes, { id: "a__f", label: "f", type: "function", file: "a.ts", group: "ui", complexity: 6 }],
    };
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(graphWithComplexFn));
      return Promise.reject(new Error("ENOENT"));
    });

    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");
    await suggestRefactoringCommand("proj", "/tmp/.nodum", { json: true, complexityThreshold: 5 });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.some((s: any) => s.kind === "high-complexity")).toBe(true);
  });

  it("prints 'no refactoring suggestions' when the graph has no issues", async () => {
    const cleanGraph = {
      project: "proj",
      stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0 },
      nodes: [{ id: "a", label: "index.ts", type: "file", file: "index.ts", group: "other" }],
      edges: [],
    };
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(cleanGraph));
      return Promise.reject(new Error("ENOENT"));
    });

    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");
    await suggestRefactoringCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No refactoring suggestions");
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { suggestRefactoringCommand } = await import("./suggest-refactoring.js");

    await expect(suggestRefactoringCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
