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

describe("generateGraph — stats (spec 036: struct/enum/protocol/extension)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates all four new optional counters as 0 for a project with none of the new types", async () => {
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".ts") return null;
      return {
        parse: (file: FileInfo) => ({
          nodes: [{ id: file.path, label: file.path, type: "function" as const, file: file.path, group: "other" }],
          edges: [],
        }),
      };
    });
    discoverFilesMock.mockResolvedValue([fileInfo("a.ts")]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(graph.stats.structs).toBe(0);
    expect(graph.stats.enums).toBe(0);
    expect(graph.stats.protocols).toBe(0);
    expect(graph.stats.extensions).toBe(0);
    // The original 5 keys are unaffected by the new counters' presence.
    expect(graph.stats.functions).toBe(1);
  });

  it("counts each new node type independently, not folded into classes/interfaces", async () => {
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".swift") return null;
      return {
        parse: (file: FileInfo) => ({
          nodes: [
            { id: "s1", label: "S", type: "struct" as const, file: file.path, group: "other" },
            { id: "e1", label: "E", type: "enum" as const, file: file.path, group: "other" },
            { id: "p1", label: "P", type: "protocol" as const, file: file.path, group: "other" },
            { id: "x1", label: "X", type: "extension" as const, file: file.path, group: "other" },
          ],
          edges: [],
        }),
      };
    });
    discoverFilesMock.mockResolvedValue([{ ...fileInfo("a.swift"), ext: ".swift" }]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(graph.stats.structs).toBe(1);
    expect(graph.stats.enums).toBe(1);
    expect(graph.stats.protocols).toBe(1);
    expect(graph.stats.extensions).toBe(1);
    expect(graph.stats.classes).toBe(0);
    expect(graph.stats.interfaces).toBe(0);
  });
});

describe("generateGraph — source-set labeling (spec 049)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".kt") return null;
      return {
        parse: (file: FileInfo) => ({
          nodes: [{ id: file.path, label: file.path, type: "function" as const, file: file.path, group: "other" }],
          edges: [],
        }),
      };
    });
  });

  it("stamps sourceSet on nodes under a KMP source-set path in the full-sync path", async () => {
    discoverFilesMock.mockResolvedValue([
      { ...fileInfo("shared/src/commonMain/kotlin/Greeting.kt"), ext: ".kt" },
      { ...fileInfo("shared/src/androidMain/kotlin/Platform.kt"), ext: ".kt" },
    ]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    const common = graph.nodes.find(n => n.file === "shared/src/commonMain/kotlin/Greeting.kt");
    const android = graph.nodes.find(n => n.file === "shared/src/androidMain/kotlin/Platform.kt");
    expect(common?.sourceSet).toBe("commonMain");
    expect(android?.sourceSet).toBe("androidMain");
  });

  it("stamps sourceSet on carried-over (unchanged) nodes in the incremental-sync path too", async () => {
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        {
          id: "shared/src/commonMain/kotlin/Greeting.kt",
          label: "Greeting.kt",
          type: "function",
          file: "shared/src/commonMain/kotlin/Greeting.kt",
          group: "other",
          // Deliberately missing sourceSet — simulates a node persisted by
          // a pre-spec-049 sync, carried over verbatim by the incremental
          // path (unchanged file). applySourceSets must still stamp it.
        },
      ],
      edges: [],
    };
    const previousFiles: FileManifest = {
      "shared/src/commonMain/kotlin/Greeting.kt": { hash: "h", mtimeMs: 1, size: 1 },
    };
    discoverChangedFilesMock.mockResolvedValue({
      changed: [],
      unchanged: previousFiles,
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.nodes[0].sourceSet).toBe("commonMain");
  });

  it("does not stamp sourceSet on a non-matching path", async () => {
    discoverFilesMock.mockResolvedValue([{ ...fileInfo("src/main.kt"), ext: ".kt" }]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(graph.nodes[0].sourceSet).toBeUndefined();
  });
});

describe("generateGraph — module labeling (spec 051)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".kt") return null;
      return {
        parse: (file: FileInfo) => ({
          nodes: [{ id: file.path, label: file.path, type: "function" as const, file: file.path, group: "other" }],
          edges: [],
        }),
      };
    });
  });

  it("stamps module on nodes under a multi-module path in the full-sync path", async () => {
    discoverFilesMock.mockResolvedValue([
      { ...fileInfo("forro/feature/src/main/kotlin/Foo.kt"), ext: ".kt" },
      { ...fileInfo("app/src/main/kotlin/Bar.kt"), ext: ".kt" },
    ]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    const feature = graph.nodes.find(n => n.file === "forro/feature/src/main/kotlin/Foo.kt");
    const app = graph.nodes.find(n => n.file === "app/src/main/kotlin/Bar.kt");
    expect(feature?.module).toBe("forro/feature");
    expect(app?.module).toBe("app");
  });

  it("stamps module on carried-over (unchanged) nodes in the incremental-sync path too", async () => {
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        {
          id: "app/src/main/kotlin/Bar.kt",
          label: "Bar.kt",
          type: "function",
          file: "app/src/main/kotlin/Bar.kt",
          group: "other",
          // Deliberately missing module — simulates a node persisted before
          // spec 051, carried over verbatim by the incremental path.
        },
      ],
      edges: [],
    };
    const previousFiles: FileManifest = {
      "app/src/main/kotlin/Bar.kt": { hash: "h", mtimeMs: 1, size: 1 },
    };
    discoverChangedFilesMock.mockResolvedValue({
      changed: [],
      unchanged: previousFiles,
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    expect(graph.nodes[0].module).toBe("app");
  });

  it("does not stamp module on a non-matching path", async () => {
    discoverFilesMock.mockResolvedValue([{ ...fileInfo("src/main.kt"), ext: ".kt" }]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(graph.nodes[0].module).toBeUndefined();
  });
});

describe("generateGraph — expect/actual edges (spec 055)", () => {
  // Mock parser: a file under commonMain emits an 'expect'-tagged node, a
  // file under iosMain emits an 'actual'-tagged node — both labeled
  // "getPlatform", standing in for kotlin.ts's own (separately tested)
  // platform-modifier extraction. This block only verifies applyExpectActual
  // is correctly wired into both sync paths over the full node array.
  beforeEach(() => {
    vi.clearAllMocks();
    selectParserMock.mockImplementation((ext: string) => {
      if (ext !== ".kt") return null;
      return {
        parse: (file: FileInfo) => {
          const platformModifier = file.path.includes("iosMain") ? "actual" : file.path.includes("commonMain") ? "expect" : undefined;
          return {
            nodes: [{
              id: file.path,
              label: "getPlatform",
              type: "function" as const,
              file: file.path,
              group: "other",
              ...(platformModifier ? { platformModifier } : {}),
            }],
            edges: [],
          };
        },
      };
    });
  });

  it("links a real expect/actual pair in the full-sync path", async () => {
    discoverFilesMock.mockResolvedValue([
      { ...fileInfo("app/src/commonMain/kotlin/Platform.kt"), ext: ".kt" },
      { ...fileInfo("app/src/iosMain/kotlin/Platform.kt"), ext: ".kt" },
    ]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    const actualizesEdges = graph.edges.filter(e => e.relation === "actualizes");
    expect(actualizesEdges).toEqual([
      { source: "app/src/iosMain/kotlin/Platform.kt", target: "app/src/commonMain/kotlin/Platform.kt", relation: "actualizes" },
    ]);
  });

  it("links a newly-added actual to a pre-existing expect in the incremental-sync path, even though only the actual's file changed", async () => {
    const previousGraph: Graph = {
      project: "proj",
      stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        {
          id: "app/src/commonMain/kotlin/Platform.kt",
          label: "getPlatform",
          type: "function",
          file: "app/src/commonMain/kotlin/Platform.kt",
          group: "other",
          module: "app",
          sourceSet: "commonMain",
          platformModifier: "expect",
        },
      ],
      edges: [],
    };
    const previousFiles: FileManifest = {
      "app/src/commonMain/kotlin/Platform.kt": { hash: "h", mtimeMs: 1, size: 1 },
    };
    discoverChangedFilesMock.mockResolvedValue({
      changed: [{ ...fileInfo("app/src/iosMain/kotlin/Platform.kt"), ext: ".kt" }],
      unchanged: previousFiles,
      deletedPaths: [],
    });

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", { previousGraph, previousFiles });

    const actualizesEdges = graph.edges.filter(e => e.relation === "actualizes");
    expect(actualizesEdges).toEqual([
      { source: "app/src/iosMain/kotlin/Platform.kt", target: "app/src/commonMain/kotlin/Platform.kt", relation: "actualizes" },
    ]);
  });

  it("produces no actualizes edges for a project with no expect/actual declarations", async () => {
    discoverFilesMock.mockResolvedValue([{ ...fileInfo("app/src/main/kotlin/Foo.kt"), ext: ".kt" }]);

    const { generateGraph } = await import("./graph-gen.js");
    const { graph } = await generateGraph("/proj", {});

    expect(graph.edges.filter(e => e.relation === "actualizes")).toEqual([]);
  });
});
