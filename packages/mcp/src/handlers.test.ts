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

describe("handleExplainArchitecture", () => {
  const layeredGraph = {
    project: "proj",
    stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
    nodes: [
      { id: "a", label: "List.tsx", type: "file", file: "src/ui/List.tsx", group: "ui" },
      { id: "b", label: "repo.ts", type: "file", file: "src/db/repo.ts", group: "repo" },
    ],
    edges: [{ source: "a", target: "b", relation: "imports" }],
  };

  function mockFiles(projectsJson: unknown, nodumrc: object | null) {
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(layeredGraph));
      if (path.endsWith("projects.json")) return Promise.resolve(JSON.stringify(projectsJson));
      if (path.endsWith(".nodumrc.json")) {
        if (nodumrc === null) return Promise.reject(new Error("ENOENT"));
        return Promise.resolve(JSON.stringify(nodumrc));
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports layers and dependencies with a 'not configured' message when no rules exist", async () => {
    mockFiles({ proj: { name: "proj", path: "/src/proj" } }, null);
    const { handleExplainArchitecture } = await import("./handlers.js");
    const result = await handleExplainArchitecture("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("ui");
    expect(text).toContain("repo");
    expect(text).toContain("ui → repo  1 imports");
    expect(text).toContain("none configured");
  });

  it("includes violations automatically when the project has configured architecture rules", async () => {
    mockFiles(
      { proj: { name: "proj", path: "/src/proj" } },
      { architecture: { rules: [{ from: "ui", to: "repo" }] } },
    );
    const { handleExplainArchitecture } = await import("./handlers.js");
    const result = await handleExplainArchitecture("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Architecture rules: 1 configured");
    expect(text).toContain("Violations: 1 found");
    expect(text).toContain("src/ui/List.tsx");
  });
});

describe("handleFindSimilarCode", () => {
  const graphWithDuplicates = {
    project: "proj",
    stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 0 },
    nodes: [
      { id: "a", label: "validateUserInput", type: "function", file: "a.ts", group: "other", duplicateHash: "h1" },
      { id: "b", label: "validateOrderInput", type: "function", file: "b.ts", group: "other", duplicateHash: "h1" },
    ],
    edges: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue(JSON.stringify(graphWithDuplicates));
  });

  it("returns a formatted match list", async () => {
    const { handleFindSimilarCode } = await import("./handlers.js");
    const result = await handleFindSimilarCode("proj", "a");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("validateUserInput");
    expect(text).toContain("validateOrderInput");
    expect(text).toContain("1 match");
  });

  it("returns a clear 'no similar code' message when there's no match", async () => {
    const { handleFindSimilarCode } = await import("./handlers.js");
    const result = await handleFindSimilarCode("proj", "nonexistent");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("No similar code found");
  });
});

describe("handleSuggestRefactoring", () => {
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

  function mockFiles(projectsJson: unknown, nodumrc: object | null) {
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(cyclicGraph));
      if (path.endsWith("projects.json")) return Promise.resolve(JSON.stringify(projectsJson));
      if (path.endsWith(".nodumrc.json")) {
        if (nodumrc === null) return Promise.reject(new Error("ENOENT"));
        return Promise.resolve(JSON.stringify(nodumrc));
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a formatted, category-grouped suggestion list without architecture rules", async () => {
    mockFiles({ proj: { name: "proj", path: "/src/proj" } }, null);
    const { handleSuggestRefactoring } = await import("./handlers.js");
    const result = await handleSuggestRefactoring("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("CYCLE");
    expect(text).not.toContain("ARCHITECTURE-VIOLATION");
  });

  it("includes architecture-violation suggestions when the project has configured rules", async () => {
    mockFiles(
      { proj: { name: "proj", path: "/src/proj" } },
      { architecture: { rules: [{ from: "ui", to: "repo" }] } },
    );
    const { handleSuggestRefactoring } = await import("./handlers.js");
    const result = await handleSuggestRefactoring("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("ARCHITECTURE-VIOLATION");
  });
});
