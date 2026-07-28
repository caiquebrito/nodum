import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Graph, FileManifest, FileInfo } from "./types.js";
import { normalizeNodeId } from "./types.js";
import { resolveRelativeImport } from "./parser/import-resolver.js";

const discoverFilesMock = vi.fn();
const discoverChangedFilesMock = vi.fn();
vi.mock("./file-discovery.js", () => ({
  discoverFiles: (...args: unknown[]) => discoverFilesMock(...args),
  discoverChangedFiles: (...args: unknown[]) => discoverChangedFilesMock(...args),
}));

// A trivial parser stand-in: for each file, emits one node named after its
// path and no edges, unless the path contains "self-edge" — then it also
// emits an edge pointing from that node to itself (used to test eviction).
const selectParserMock = vi.fn();
vi.mock("./parser/index.js", () => ({
  selectParser: (ext: string) => selectParserMock(ext),
}));

function fileInfo(path: string, content = "x"): FileInfo {
  return { path, ext: ".ts", content, hash: `hash-${path}`, mtimeMs: 1, size: content.length };
}

describe("generateGraph — incremental mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".ts") return null;
      return {
        parse: (file: FileInfo) => {
          const nodeId = file.path;
          const nodes = [{ id: nodeId, label: file.path, type: "function" as const, file: file.path, group: "other" }];
          const edges = file.path.includes("self-edge")
            ? [{ source: nodeId, target: nodeId, relation: "defines" as const }]
            : [];
          return { nodes, edges };
        },
      };
    });
  });

  it("re-parses only changed files, carrying over unchanged files' nodes verbatim", async () => {
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        { id: "a.ts", label: "a.ts (old)", type: "function", file: "a.ts", group: "other", embedding: [0.1] },
        { id: "b.ts", label: "b.ts", type: "function", file: "b.ts", group: "other" },
      ],
      edges: [],
    };
    const previousFiles: FileManifest = {
      "a.ts": { hash: "old-hash", mtimeMs: 1, size: 1 },
      "b.ts": { hash: "hash-b", mtimeMs: 1, size: 1 },
    };

    discoverChangedFilesMock.mockResolvedValue({
      changed: [fileInfo("a.ts")],
      unchanged: { "b.ts": previousFiles["b.ts"] },
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph, files } = await generateGraph("/proj", { previousGraph, previousFiles });

    // b.ts untouched — original node (including embedding) preserved verbatim
    const bNode = graph.nodes.find(n => n.id === "b.ts");
    expect(bNode).toEqual(previousGraph.nodes[1]);

    // a.ts re-parsed — old node replaced with a freshly parsed one
    const aNode = graph.nodes.find(n => n.id === "a.ts");
    expect(aNode?.label).toBe("a.ts"); // fresh parse, not "a.ts (old)"

    expect(graph.stats.files).toBe(2);
    expect(files).toEqual({ "a.ts": { hash: "hash-a.ts", mtimeMs: 1, size: 1 }, "b.ts": previousFiles["b.ts"] });
    expect(discoverFilesMock).not.toHaveBeenCalled();
  });

  it("evicts nodes and edges belonging to a deleted file", async () => {
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: "gone-self-edge.ts", label: "gone", type: "function", file: "gone-self-edge.ts", group: "other" },
        { id: "keep.ts", label: "keep", type: "function", file: "keep.ts", group: "other" },
      ],
      edges: [{ source: "gone-self-edge.ts", target: "gone-self-edge.ts", relation: "defines" }],
    };
    const previousFiles: FileManifest = {
      "gone-self-edge.ts": { hash: "h1", mtimeMs: 1, size: 1 },
      "keep.ts": { hash: "h2", mtimeMs: 1, size: 1 },
    };

    discoverChangedFilesMock.mockResolvedValue({
      changed: [],
      unchanged: { "keep.ts": previousFiles["keep.ts"] },
      deletedPaths: ["gone-self-edge.ts"],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph, files } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.nodes.map(n => n.id)).toEqual(["keep.ts"]);
    expect(graph.edges).toEqual([]);
    expect(graph.stats.files).toBe(1);
    expect(files["gone-self-edge.ts"]).toBeUndefined();
  });

  it("falls back to a full scan when previousGraph/previousFiles are omitted", async () => {
    discoverFilesMock.mockResolvedValue([fileInfo("only.ts")]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(discoverChangedFilesMock).not.toHaveBeenCalled();
    expect(graph.nodes.map(n => n.id)).toEqual(["only.ts"]);
  });
});

describe("generateGraph — import edge resolution", () => {
  // Real file-node parser stand-in: each file gets a proper (normalizeNodeId)
  // file node, plus whatever raw import specifiers this test configured for
  // that path via `fileImports`.
  let fileImports: Record<string, string[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    fileImports = {};
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".ts") return null;
      return {
        parse: (file: FileInfo) => {
          const fileId = normalizeNodeId(file.path, file.path, "file");
          const nodes = [{ id: fileId, label: file.path, type: "file" as const, file: file.path, group: "other" }];
          const imports = fileImports[file.path];
          return { nodes, edges: [], ...(imports ? { imports } : {}) };
        },
        // Mirrors TypeScriptParser/JavaScriptParser's real resolveImport —
        // resolveImportsInto (graph-gen.ts) now dispatches through this
        // method rather than a hardcoded extension check (spec 030).
        resolveImport: (specifier: string, importingFilePath: string, knownFileIds: Set<string>) => {
          const id = resolveRelativeImport(importingFilePath, specifier, knownFileIds);
          return id ? [id] : [];
        },
      };
    });
  });

  it("resolves relative TS/JS imports into cross-file edges on a full scan", async () => {
    fileImports["src/a.ts"] = ["./b"];
    discoverFilesMock.mockResolvedValue([fileInfo("src/a.ts"), fileInfo("src/b.ts")]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    const aId = normalizeNodeId("src/a.ts", "src/a.ts", "file");
    const bId = normalizeNodeId("src/b.ts", "src/b.ts", "file");
    expect(graph.edges).toContainEqual({ source: aId, target: bId, relation: "imports" });
  });

  it("incremental: an import edge survives when only the target file changes", async () => {
    const aId = normalizeNodeId("src/a.ts", "src/a.ts", "file");
    const bId = normalizeNodeId("src/b.ts", "src/b.ts", "file");
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: aId, label: "src/a.ts", type: "file", file: "src/a.ts", group: "other" },
        { id: bId, label: "src/b.ts", type: "file", file: "src/b.ts", group: "other" },
      ],
      edges: [{ source: aId, target: bId, relation: "imports" }],
    };
    const previousFiles: FileManifest = {
      "src/a.ts": { hash: "hash-a", mtimeMs: 1, size: 1 },
      "src/b.ts": { hash: "old-hash-b", mtimeMs: 1, size: 1 },
    };

    discoverChangedFilesMock.mockResolvedValue({
      changed: [fileInfo("src/b.ts")],
      unchanged: { "src/a.ts": previousFiles["src/a.ts"] },
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.edges).toContainEqual({ source: aId, target: bId, relation: "imports" });
  });

  it("incremental: an import edge is dropped when its target file is deleted", async () => {
    const aId = normalizeNodeId("src/a.ts", "src/a.ts", "file");
    const bId = normalizeNodeId("src/b.ts", "src/b.ts", "file");
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: aId, label: "src/a.ts", type: "file", file: "src/a.ts", group: "other" },
        { id: bId, label: "src/b.ts", type: "file", file: "src/b.ts", group: "other" },
      ],
      edges: [{ source: aId, target: bId, relation: "imports" }],
    };
    const previousFiles: FileManifest = {
      "src/a.ts": { hash: "hash-a", mtimeMs: 1, size: 1 },
      "src/b.ts": { hash: "hash-b", mtimeMs: 1, size: 1 },
    };

    discoverChangedFilesMock.mockResolvedValue({
      changed: [],
      unchanged: { "src/a.ts": previousFiles["src/a.ts"] },
      deletedPaths: ["src/b.ts"],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.edges).toEqual([]);
  });

  it("incremental: a changed importer that removed an import doesn't leave a stale edge", async () => {
    const aId = normalizeNodeId("src/a.ts", "src/a.ts", "file");
    const bId = normalizeNodeId("src/b.ts", "src/b.ts", "file");
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: aId, label: "src/a.ts", type: "file", file: "src/a.ts", group: "other" },
        { id: bId, label: "src/b.ts", type: "file", file: "src/b.ts", group: "other" },
      ],
      edges: [{ source: aId, target: bId, relation: "imports" }],
    };
    const previousFiles: FileManifest = {
      "src/a.ts": { hash: "old-hash-a", mtimeMs: 1, size: 1 },
      "src/b.ts": { hash: "hash-b", mtimeMs: 1, size: 1 },
    };

    // a.ts changed and no longer imports b.ts (fileImports["src/a.ts"] left unset)
    discoverChangedFilesMock.mockResolvedValue({
      changed: [fileInfo("src/a.ts")],
      unchanged: { "src/b.ts": previousFiles["src/b.ts"] },
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.edges).toEqual([]);
  });
});
