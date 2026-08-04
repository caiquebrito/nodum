import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Graph, Node } from "@caiquebrito/nodum-core";

// Deterministic fake vector so cosine similarity behaves predictably in tests,
// without downloading the real model.
function fakeVectorFrom(text: string): number[] {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % vec.length] += text.charCodeAt(i);
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

const pipelineMock = vi.fn();

vi.mock("@xenova/transformers", () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (normA * normB);
}

function makeGraph(nodes: Node[], edges: Graph["edges"] = []): Graph {
  return {
    project: "test",
    stats: { files: 0, functions: 0, classes: 0, interfaces: 0, edges: edges.length },
    nodes,
    edges,
  };
}

describe("embeddings (local model)", () => {
  beforeEach(() => {
    vi.resetModules();
    pipelineMock.mockReset();
  });

  it("embeds similar strings closer than unrelated strings", async () => {
    pipelineMock.mockResolvedValue(
      vi.fn(async (text: string) => ({ data: new Float32Array(fakeVectorFrom(text)) }))
    );

    const { generateQueryEmbedding } = await import("./embeddings.js");

    const a = await generateQueryEmbedding("login handler");
    const b = await generateQueryEmbedding("login function");
    const c = await generateQueryEmbedding("database migration");

    expect(a.length).toBeGreaterThan(0);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it("hasEmbeddings requires at least 50% of non-file nodes embedded and a matching version", async () => {
    const { hasEmbeddings, EMBEDDING_TEXT_VERSION } = await import("./embeddings.js");

    const nodes: Node[] = [
      { id: "1", label: "a", type: "function", file: "a.ts", group: "g" },
      { id: "2", label: "b", type: "function", file: "b.ts", group: "g" },
      { id: "3", label: "c", type: "function", file: "c.ts", group: "g", embedding: [0.1, 0.2] },
      { id: "4", label: "d.ts", type: "file", file: "d.ts", group: "g" },
    ];

    // 1 of 3 non-file nodes embedded (33%) — below the 50% threshold
    expect(hasEmbeddings(nodes, EMBEDDING_TEXT_VERSION)).toBe(false);

    nodes[0].embedding = [0.3, 0.4];
    // 2 of 3 non-file nodes embedded (67%) — meets the threshold, version matches
    expect(hasEmbeddings(nodes, EMBEDDING_TEXT_VERSION)).toBe(true);

    // Same nodes, but a stale/missing embeddingVersion means those vectors
    // were built from old text — treated as unembedded regardless of %.
    expect(hasEmbeddings(nodes, undefined)).toBe(false);
    expect(hasEmbeddings(nodes, EMBEDDING_TEXT_VERSION - 1)).toBe(false);
  });

  it("returns false, not vacuously true, for a graph with zero non-file nodes", async () => {
    const { hasEmbeddings, EMBEDDING_TEXT_VERSION } = await import("./embeddings.js");

    const allFileNodes: Node[] = [
      { id: "1", label: "a.ts", type: "file", file: "a.ts", group: "g" },
      { id: "2", label: "b.ts", type: "file", file: "b.ts", group: "g" },
    ];

    // 0 non-file nodes means 0 >= 0 * 0.5 without the guard — vacuously true.
    expect(hasEmbeddings(allFileNodes, EMBEDDING_TEXT_VERSION)).toBe(false);
  });

  it("returns [] and does not throw when the pipeline fails", async () => {
    pipelineMock.mockResolvedValue(
      vi.fn(async () => {
        throw new Error("model load failed");
      })
    );

    const { generateQueryEmbedding } = await import("./embeddings.js");

    await expect(generateQueryEmbedding("anything")).resolves.toEqual([]);
  });

  it("generateGraphEmbeddings skips already-embedded and file-type nodes when version matches", async () => {
    pipelineMock.mockResolvedValue(
      vi.fn(async (text: string) => ({ data: new Float32Array(fakeVectorFrom(text)) }))
    );

    const { generateGraphEmbeddings, EMBEDDING_TEXT_VERSION } = await import("./embeddings.js");

    const preEmbedded = [0.9, 0.9];
    const nodes: Node[] = [
      { id: "1", label: "already", type: "function", file: "a.ts", group: "g", embedding: preEmbedded },
      { id: "2", label: "file node", type: "file", file: "b.ts", group: "g" },
      { id: "3", label: "needs embedding", type: "function", file: "c.ts", group: "g" },
    ];
    const graph = makeGraph(nodes);
    graph.embeddingVersion = EMBEDDING_TEXT_VERSION;

    await generateGraphEmbeddings(graph);

    expect(nodes[0].embedding).toBe(preEmbedded); // untouched
    expect(nodes[1].embedding).toBeUndefined(); // file nodes never embedded
    expect(nodes[2].embedding).toBeDefined();
    expect(nodes[2].embedding!.length).toBeGreaterThan(0);
    expect(graph.embeddingVersion).toBe(EMBEDDING_TEXT_VERSION);
  });

  it("generateGraphEmbeddings re-embeds every non-file node when embeddingVersion is stale or missing", async () => {
    pipelineMock.mockResolvedValue(
      vi.fn(async (text: string) => ({ data: new Float32Array(fakeVectorFrom(text)) }))
    );

    const { generateGraphEmbeddings, EMBEDDING_TEXT_VERSION } = await import("./embeddings.js");

    const staleEmbedding = [0.1, 0.1];
    const nodes: Node[] = [
      { id: "1", label: "already", type: "function", file: "a.ts", group: "g", embedding: staleEmbedding },
    ];
    const graph = makeGraph(nodes);
    // embeddingVersion left unset — simulates a pre-067 graph.json on disk.

    await generateGraphEmbeddings(graph);

    expect(nodes[0].embedding).not.toBe(staleEmbedding); // re-embedded, not reused
    expect(graph.embeddingVersion).toBe(EMBEDDING_TEXT_VERSION);
  });

  describe("buildNodeEmbeddingText", () => {
    it("includes split label, type, file basename, and only the meta fields that are set", async () => {
      const { buildNodeEmbeddingText, buildAdjacencyLabels } = await import("./embeddings.js");

      const node: Node = {
        id: "1",
        label: "authenticateUser",
        type: "function",
        file: "src/auth/login.ts",
        group: "service",
      };
      const adjacency = buildAdjacencyLabels(makeGraph([node]));

      const text = buildNodeEmbeddingText(node, adjacency);

      expect(text).toContain("authenticate user — function in login.ts");
      expect(text).toContain("layer: service");
      expect(text).not.toContain("module:");
      expect(text).not.toContain("sourceSet:");
      expect(text).not.toContain("calls:");
      expect(text).not.toContain("used by:");
    });

    it("includes module and sourceSet when present", async () => {
      const { buildNodeEmbeddingText, buildAdjacencyLabels } = await import("./embeddings.js");

      const node: Node = {
        id: "1",
        label: "getUserById",
        type: "method",
        file: "feature/user/UserRepo.kt",
        group: "data",
        module: "feature/user",
        sourceSet: "commonMain",
      };
      const adjacency = buildAdjacencyLabels(makeGraph([node]));

      const text = buildNodeEmbeddingText(node, adjacency);

      expect(text).toContain("module: feature/user");
      expect(text).toContain("layer: data");
      expect(text).toContain("sourceSet: commonMain");
    });

    it("looks up calls/used-by labels from the graph's edges, capped at 5 each", async () => {
      const { buildNodeEmbeddingText, buildAdjacencyLabels } = await import("./embeddings.js");

      const center: Node = { id: "center", label: "handleRequest", type: "function", file: "a.ts", group: "g" };
      const callees = Array.from({ length: 7 }, (_, i) => ({
        id: `callee${i}`, label: `callee${i}`, type: "function" as const, file: "a.ts", group: "g",
      }));
      const caller: Node = { id: "caller", label: "main", type: "function", file: "a.ts", group: "g" };

      const nodes = [center, ...callees, caller];
      const edges: Graph["edges"] = [
        ...callees.map(c => ({ source: "center", target: c.id, relation: "calls" as const })),
        { source: "caller", target: "center", relation: "calls" as const },
      ];
      const adjacency = buildAdjacencyLabels(makeGraph(nodes, edges));

      const text = buildNodeEmbeddingText(center, adjacency);

      expect(text).toContain("used by: main");
      const callsLine = text.split("\n").find(l => l.startsWith("calls:"))!;
      expect(callsLine).toBeDefined();
      // Capped at 5, even though 7 callees exist.
      expect(callsLine.split(",").length).toBe(5);
    });

    it("omits calls/used-by lines entirely when a node has no edges", async () => {
      const { buildNodeEmbeddingText, buildAdjacencyLabels } = await import("./embeddings.js");

      const node: Node = { id: "1", label: "isolated", type: "function", file: "a.ts", group: "g" };
      const adjacency = buildAdjacencyLabels(makeGraph([node]));

      const text = buildNodeEmbeddingText(node, adjacency);

      expect(text).not.toContain("calls:");
      expect(text).not.toContain("used by:");
    });
  });
});
