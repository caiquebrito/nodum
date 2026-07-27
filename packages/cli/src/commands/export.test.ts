import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
const writeFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

const graph = {
  project: "sample-project",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [{ id: "n1", label: "n1", type: "function", file: "a.ts", group: "other" }],
  edges: [],
};

describe("exportGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    readFileMock.mockResolvedValue(JSON.stringify(graph));
  });

  it("errors with a clear message and writes nothing when no graph is synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { exportGraph } = await import("./export.js");

    await expect(exportGraph("/tmp/project", "/tmp/.nodum", { format: "json" })).rejects.toThrow(
      "No synced graph found",
    );
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("format: json writes to the default <project>.graph.json path", async () => {
    const { exportGraph } = await import("./export.js");
    await exportGraph("/tmp/project", "/tmp/.nodum", { format: "json" });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][0]).toBe("project.graph.json");
  });

  it("format: graphml writes to the default <project>.graphml path", async () => {
    const { exportGraph } = await import("./export.js");
    await exportGraph("/tmp/project", "/tmp/.nodum", { format: "graphml" });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][0]).toBe("project.graphml");
  });

  it("format: csv writes exactly two files with the expected default names", async () => {
    const { exportGraph } = await import("./export.js");
    await exportGraph("/tmp/project", "/tmp/.nodum", { format: "csv" });

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    const paths = writeFileMock.mock.calls.map(c => c[0]).sort();
    expect(paths).toEqual(["project.edges.csv", "project.nodes.csv"]);
  });

  it("--output overrides the default path for json", async () => {
    const { exportGraph } = await import("./export.js");
    await exportGraph("/tmp/project", "/tmp/.nodum", { format: "json", output: "custom.json" });

    expect(writeFileMock.mock.calls[0][0]).toBe("custom.json");
  });

  it("--output overrides the base path for csv", async () => {
    const { exportGraph } = await import("./export.js");
    await exportGraph("/tmp/project", "/tmp/.nodum", { format: "csv", output: "custom" });

    const paths = writeFileMock.mock.calls.map(c => c[0]).sort();
    expect(paths).toEqual(["custom.edges.csv", "custom.nodes.csv"]);
  });

  it("an unknown format throws before any write", async () => {
    const { exportGraph } = await import("./export.js");

    await expect(
      exportGraph("/tmp/project", "/tmp/.nodum", { format: "yaml" as never }),
    ).rejects.toThrow("Unknown export format");
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
