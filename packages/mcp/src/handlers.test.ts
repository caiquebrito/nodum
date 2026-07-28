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

describe("handleTraceImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue(JSON.stringify(graph));
  });

  it("returns a formatted, distance-grouped summary for a node with transitive dependents", async () => {
    const { handleTraceImpact } = await import("./handlers.js");
    const result = await handleTraceImpact("proj", "c");

    expect("error" in result).toBe(false);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("2 files");
    expect(text).toContain("b.ts");
    expect(text).toContain("a.ts");
  });

  it("returns a clear 'no dependents' message for a node nothing depends on", async () => {
    const { handleTraceImpact } = await import("./handlers.js");
    const result = await handleTraceImpact("proj", "a");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("No files depend on");
  });

  it("returns an error for a nonexistent node id", async () => {
    const { handleTraceImpact } = await import("./handlers.js");
    const result = await handleTraceImpact("proj", "nonexistent");

    expect(result).toEqual({ error: "Node not found: nonexistent" });
  });
});

describe("handleFindBottlenecks", () => {
  const graphWithScores = {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: "c__f", label: "f", type: "function", file: "c.ts", group: "other", complexity: 5 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue(JSON.stringify(graphWithScores));
  });

  it("returns a formatted ranked summary", async () => {
    const { handleFindBottlenecks } = await import("./handlers.js");
    const result = await handleFindBottlenecks("proj");

    expect("error" in result).toBe(false);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Bottlenecks");
    expect(text).toContain("c.ts");
    expect(text).toContain("complexity=5");
  });

  it("returns a clear 'none found' message when no function is scored", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { handleFindBottlenecks } = await import("./handlers.js");
    const result = await handleFindBottlenecks("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("No scored functions found");
  });
});
