import { describe, it, expect, vi, beforeEach } from "vitest";

const { existsSyncMock, loadGraphMock, handleSyncMock, syncProjectMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  loadGraphMock: vi.fn(),
  handleSyncMock: vi.fn(),
  syncProjectMock: vi.fn(),
}));

vi.mock("fs", () => ({ existsSync: existsSyncMock }));
vi.mock("@caiquebrito/nodum-query", () => ({
  NODUM_DATA_DIR: "/home/.nodum",
  loadGraph: loadGraphMock,
  handleSync: handleSyncMock,
}));
vi.mock("@caiquebrito/nodum-core", () => ({ syncProject: syncProjectMock }));

const { ProjectContext } = await import("./project.js");

const FAKE_GRAPH = { project: "my-project", stats: {}, nodes: [], edges: [] } as any;

describe("ProjectContext", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("derives the project name from the root path's basename", () => {
    const project = new ProjectContext("/Users/dev/repos/my-project");
    expect(project.projectName).toBe("my-project");
  });

  it("loads straight from disk when a graph.json already exists, without a full sync", async () => {
    existsSyncMock.mockReturnValue(true);
    loadGraphMock.mockResolvedValue(FAKE_GRAPH);

    const project = new ProjectContext("/Users/dev/repos/my-project");
    const graph = await project.ensureGraph();

    expect(graph).toBe(FAKE_GRAPH);
    expect(handleSyncMock).not.toHaveBeenCalled();
    expect(loadGraphMock).toHaveBeenCalledWith("my-project");
  });

  it("runs a full sync (with embeddings, via handleSync) when no graph exists yet", async () => {
    existsSyncMock.mockReturnValue(false);
    handleSyncMock.mockResolvedValue({ content: [{ type: "text", text: "synced" }] });
    loadGraphMock.mockResolvedValue(FAKE_GRAPH);

    const project = new ProjectContext("/Users/dev/repos/my-project");
    const graph = await project.ensureGraph();

    expect(handleSyncMock).toHaveBeenCalledWith("/Users/dev/repos/my-project");
    expect(graph).toBe(FAKE_GRAPH);
  });

  it("throws when the initial full sync itself fails", async () => {
    existsSyncMock.mockReturnValue(false);
    handleSyncMock.mockResolvedValue({ isError: true, content: [{ type: "text", text: "boom" }] });

    const project = new ProjectContext("/Users/dev/repos/my-project");
    await expect(project.ensureGraph()).rejects.toThrow("boom");
  });

  it("only syncs once for concurrent callers — dedupes in-flight ensureGraph() calls", async () => {
    existsSyncMock.mockReturnValue(true);
    let resolveLoad: (g: unknown) => void;
    loadGraphMock.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)));

    const project = new ProjectContext("/Users/dev/repos/my-project");
    const first = project.ensureGraph();
    const second = project.ensureGraph();
    resolveLoad!(FAKE_GRAPH);

    await Promise.all([first, second]);
    expect(loadGraphMock).toHaveBeenCalledTimes(1);
  });

  it("caches the graph after the first load — a later ensureGraph() doesn't re-sync", async () => {
    existsSyncMock.mockReturnValue(true);
    loadGraphMock.mockResolvedValue(FAKE_GRAPH);

    const project = new ProjectContext("/Users/dev/repos/my-project");
    await project.ensureGraph();
    await project.ensureGraph();

    expect(loadGraphMock).toHaveBeenCalledTimes(1);
  });

  it("resync() calls syncProject directly (incremental, no embeddings) and updates the cached graph", async () => {
    const resyncedGraph = { project: "my-project", stats: {}, nodes: [{ id: "new" }], edges: [] } as any;
    syncProjectMock.mockResolvedValue(resyncedGraph);

    const project = new ProjectContext("/Users/dev/repos/my-project");
    const graph = await project.resync();

    expect(syncProjectMock).toHaveBeenCalledWith(
      "/Users/dev/repos/my-project",
      "/home/.nodum",
      { incremental: true },
    );
    expect(graph).toBe(resyncedGraph);
    expect(project.currentGraph()).toBe(resyncedGraph);
    expect(handleSyncMock).not.toHaveBeenCalled();
  });
});
