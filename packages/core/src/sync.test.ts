import { describe, it, expect, vi, beforeEach } from "vitest";

const mkdirMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const readFileMock = vi.fn().mockRejectedValue(new Error("ENOENT"));

vi.mock("fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

vi.mock("fs", () => ({
  existsSync: () => true,
}));

const baseGraph = {
  project: "sample-project",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [{ id: "n1", label: "n1", type: "function", file: "a.ts", group: "other" }],
  edges: [],
};

const baseFileManifest = {
  "a.ts": { hash: "deadbeef", mtimeMs: 1700000000000, size: 42 },
};

const generateGraphMock = vi.fn();
vi.mock("./graph-gen.js", () => ({
  generateGraph: (...args: unknown[]) => generateGraphMock(...args),
}));

const analyzeProjectMock = vi.fn().mockResolvedValue({
  languages: ["typescript"],
  frameworks: [],
  databases: [],
  runtimes: [],
  buildTools: [],
  testFrameworks: [],
});
vi.mock("./analyzer/index.js", () => ({
  analyzeProject: (...args: unknown[]) => analyzeProjectMock(...args),
}));

const buildClustersMock = vi.fn().mockReturnValue({
  clusters: [{ id: "cluster_0", label: "c", nodeCount: 1, nodeIds: ["n1"], summary: "", externalDeps: [], types: [] }],
  nodeToCluster: new Map([["n1", "cluster_0"]]),
});
vi.mock("./analyzer/clustering.js", () => ({
  buildClusters: (...args: unknown[]) => buildClustersMock(...args),
}));

const injectCLAUDEContextMock = vi.fn().mockResolvedValue(undefined);
const appendActivityLogMock = vi.fn().mockResolvedValue(undefined);
const buildAndWriteSummaryMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./memory/index.js", () => ({
  injectCLAUDEContext: (...args: unknown[]) => injectCLAUDEContextMock(...args),
  appendActivityLog: (...args: unknown[]) => appendActivityLogMock(...args),
  buildAndWriteSummary: (...args: unknown[]) => buildAndWriteSummaryMock(...args),
}));

describe("core syncProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    generateGraphMock.mockResolvedValue({
      graph: { ...baseGraph, nodes: [...baseGraph.nodes], edges: [...baseGraph.edges] },
      files: { ...baseFileManifest },
    });
  });

  it("clusters exactly once and returns a graph with clusters populated", async () => {
    const { syncProject } = await import("./sync.js");

    const graph = await syncProject("/tmp/project", "/tmp/.nodum");

    expect(buildClustersMock).toHaveBeenCalledTimes(1);
    expect(graph.clusters).toHaveLength(1);
    expect(graph.nodeToCluster).toEqual({ n1: "cluster_0" });
  });

  it("invokes hooks when provided and succeeds when hooks are omitted", async () => {
    const { syncProject } = await import("./sync.js");

    const onParseProgress = vi.fn();
    const onClusterProgress = vi.fn();
    const onStep = vi.fn();

    await syncProject("/tmp/project", "/tmp/.nodum", { onParseProgress, onClusterProgress, onStep });

    expect(generateGraphMock).toHaveBeenCalledWith("/tmp/project", {
      onProgress: onParseProgress,
      previousGraph: undefined,
      previousFiles: undefined,
    });
    expect(buildClustersMock).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), onClusterProgress);
    expect(onStep).toHaveBeenCalledWith("Detecting stack");

    // Omitted hooks must not throw
    await expect(syncProject("/tmp/project", "/tmp/.nodum")).resolves.toBeDefined();
  });

  it("merges into an existing projects.json instead of clobbering other projects", async () => {
    const existing = {
      "other-project": {
        name: "other-project",
        path: "/tmp/.nodum/other-project",
        lastSync: "2026-01-01T00:00:00.000Z",
        stats: { files: 5, functions: 5, classes: 1, interfaces: 0, edges: 2 },
        stack: { languages: ["python"], frameworks: [] },
      },
    };
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("projects.json")) return Promise.resolve(JSON.stringify(existing));
      return Promise.reject(new Error("ENOENT"));
    });

    const { syncProject } = await import("./sync.js");
    await syncProject("/tmp/project", "/tmp/.nodum");

    const projectsWrite = writeFileMock.mock.calls.find(([path]) => String(path).endsWith("projects.json"));
    expect(projectsWrite).toBeDefined();
    const written = JSON.parse(projectsWrite![1] as string);
    expect(written["other-project"]).toEqual(existing["other-project"]);
    expect(written["sample-project"]).toBeDefined();
  });

  it("writes graph/files.json as a sibling of graph/graph.json", async () => {
    const { syncProject } = await import("./sync.js");
    await syncProject("/tmp/project", "/tmp/.nodum");

    const filesWrite = writeFileMock.mock.calls.find(([path]) => String(path).endsWith("files.json"));
    expect(filesWrite).toBeDefined();
    const written = JSON.parse(filesWrite![1] as string);
    expect(written).toEqual(baseFileManifest);
  });

  it("incremental: true loads the previous graph/files and passes them through", async () => {
    const previousGraph = { ...baseGraph, project: "sample-project" };
    readFileMock.mockImplementation((path: string) => {
      if (path.endsWith("graph/graph.json")) return Promise.resolve(JSON.stringify(previousGraph));
      if (path.endsWith("graph/files.json")) return Promise.resolve(JSON.stringify(baseFileManifest));
      return Promise.reject(new Error("ENOENT"));
    });

    const { syncProject } = await import("./sync.js");
    await syncProject("/tmp/project", "/tmp/.nodum", { incremental: true });

    expect(generateGraphMock).toHaveBeenCalledWith("/tmp/project", {
      onProgress: undefined,
      previousGraph,
      previousFiles: baseFileManifest,
    });
  });

  it("incremental: true with no previous sync on disk falls back to a full sync", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));

    const { syncProject } = await import("./sync.js");
    await expect(syncProject("/tmp/project", "/tmp/.nodum", { incremental: true })).resolves.toBeDefined();

    expect(generateGraphMock).toHaveBeenCalledWith("/tmp/project", {
      onProgress: undefined,
      previousGraph: undefined,
      previousFiles: undefined,
    });
  });

  it("propagates errors from generateGraph with the project path preserved", async () => {
    generateGraphMock.mockRejectedValue(new Error("parse blew up"));
    const { syncProject } = await import("./sync.js");

    await expect(syncProject("/tmp/project", "/tmp/.nodum")).rejects.toThrow("parse blew up");
  });

  it("writeGraphFile persists to the graph's existing sync location", async () => {
    const { writeGraphFile } = await import("./sync.js");

    await writeGraphFile("/tmp/.nodum", "sample-project", baseGraph as any);

    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/.nodum/sample-project/graph/graph.json",
      JSON.stringify(baseGraph, null, 2),
      "utf-8",
    );
  });
});
