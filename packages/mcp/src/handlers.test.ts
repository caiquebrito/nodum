import { describe, it, expect, vi, beforeEach } from "vitest";
import { globalGraphCache } from "./graph-cache.js";

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

describe("handleGetGraph — spec 036 optional stats lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalGraphCache.clear();
  });

  it("omits struct/enum/protocol/extension lines entirely for a project with none of them", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { handleGetGraph } = await import("./handlers.js");
    const result = await handleGetGraph("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).not.toContain("Structs");
    expect(text).not.toContain("Enums");
    expect(text).not.toContain("Protocols");
    expect(text).not.toContain("Extensions");
  });

  it("includes only the non-zero new-type lines for a mixed Swift-ish project", async () => {
    const swiftyGraph = {
      ...graph,
      stats: { ...graph.stats, structs: 2, enums: 0, protocols: 1, extensions: 0 },
      nodes: [
        ...graph.nodes,
        { id: "s1", label: "S", type: "struct", file: "a.swift", group: "other" },
        { id: "s2", label: "S2", type: "struct", file: "a.swift", group: "other" },
        { id: "p1", label: "P", type: "protocol", file: "a.swift", group: "other" },
      ],
    };
    readFileMock.mockResolvedValue(JSON.stringify(swiftyGraph));
    const { handleGetGraph } = await import("./handlers.js");
    const result = await handleGetGraph("proj");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Structs: 2");
    expect(text).toContain("Protocols: 1");
    expect(text).not.toContain("Enums");
    expect(text).not.toContain("Extensions");
  });
});

describe("handleTraceImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalGraphCache.clear();
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
    globalGraphCache.clear();
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
    globalGraphCache.clear();
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
    globalGraphCache.clear();
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
    globalGraphCache.clear();
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

describe("handleAnalyzeFile", () => {
  const bigFileGraph = {
    project: "proj",
    stats: { files: 1, functions: 30, classes: 0, interfaces: 0, edges: 0 },
    nodes: [
      { id: "big.ts", label: "big.ts", type: "file", file: "big.ts", group: "other" },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `big.ts__fn${i}`,
        label: `fn${i}`,
        type: "function",
        file: "big.ts",
        group: "other",
      })),
    ],
    edges: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalGraphCache.clear();
    readFileMock.mockResolvedValue(JSON.stringify(bigFileGraph));
  });

  it("caps the member list and shows an '... and N more' suffix for a file with many members", async () => {
    const { handleAnalyzeFile } = await import("./handlers.js");
    const result = await handleAnalyzeFile("proj", "big.ts");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("... and 10 more");
    expect(text).toContain("fn0");
    expect(text).not.toContain("fn29");
  });

  it("shows no truncation suffix when member count is within the cap", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(graph));
    const { handleAnalyzeFile } = await import("./handlers.js");
    const result = await handleAnalyzeFile("proj", "a.ts");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).not.toContain("more");
  });
});

describe("handleExpandCluster", () => {
  const bigClusterGraph = {
    project: "proj",
    stats: { files: 30, functions: 0, classes: 0, interfaces: 0, edges: 0 },
    nodes: Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      label: `n${i}.ts`,
      type: "file",
      file: `n${i}.ts`,
      group: "other",
    })),
    edges: [],
    clusters: [
      {
        id: "cluster-1",
        label: "Big Cluster",
        summary: "a big cluster",
        types: ["file"],
        externalDeps: Array.from({ length: 25 }, (_, i) => `ext${i}`),
        nodeIds: Array.from({ length: 30 }, (_, i) => `n${i}`),
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalGraphCache.clear();
    readFileMock.mockResolvedValue(JSON.stringify(bigClusterGraph));
  });

  it("caps member nodes and external deps with '... and N more' suffixes", async () => {
    const { handleExpandCluster } = await import("./handlers.js");
    const result = await handleExpandCluster("proj", "cluster-1");

    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("... and 10 more"); // 30 members - 20 cap
    expect(text).toContain("... and 5 more"); // 25 externalDeps - 20 cap
  });
});
