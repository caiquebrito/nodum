import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Node } from "@caiquebrito/nodum-core";

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

  it("hasEmbeddings requires at least 50% of non-file nodes embedded", async () => {
    const { hasEmbeddings } = await import("./embeddings.js");

    const nodes: Node[] = [
      { id: "1", label: "a", type: "function", file: "a.ts", group: "g" },
      { id: "2", label: "b", type: "function", file: "b.ts", group: "g" },
      { id: "3", label: "c", type: "function", file: "c.ts", group: "g", embedding: [0.1, 0.2] },
      { id: "4", label: "d.ts", type: "file", file: "d.ts", group: "g" },
    ];

    // 1 of 3 non-file nodes embedded (33%) — below the 50% threshold
    expect(hasEmbeddings(nodes)).toBe(false);

    nodes[0].embedding = [0.3, 0.4];
    // 2 of 3 non-file nodes embedded (67%) — meets the threshold
    expect(hasEmbeddings(nodes)).toBe(true);
  });

  it("returns false, not vacuously true, for a graph with zero non-file nodes", async () => {
    const { hasEmbeddings } = await import("./embeddings.js");

    const allFileNodes: Node[] = [
      { id: "1", label: "a.ts", type: "file", file: "a.ts", group: "g" },
      { id: "2", label: "b.ts", type: "file", file: "b.ts", group: "g" },
    ];

    // 0 non-file nodes means 0 >= 0 * 0.5 without the guard — vacuously true.
    expect(hasEmbeddings(allFileNodes)).toBe(false);
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

  it("generateGraphEmbeddings skips already-embedded and file-type nodes", async () => {
    pipelineMock.mockResolvedValue(
      vi.fn(async (text: string) => ({ data: new Float32Array(fakeVectorFrom(text)) }))
    );

    const { generateGraphEmbeddings } = await import("./embeddings.js");

    const preEmbedded = [0.9, 0.9];
    const nodes: Node[] = [
      { id: "1", label: "already", type: "function", file: "a.ts", group: "g", embedding: preEmbedded },
      { id: "2", label: "file node", type: "file", file: "b.ts", group: "g" },
      { id: "3", label: "needs embedding", type: "function", file: "c.ts", group: "g" },
    ];

    await generateGraphEmbeddings(nodes);

    expect(nodes[0].embedding).toBe(preEmbedded); // untouched
    expect(nodes[1].embedding).toBeUndefined(); // file nodes never embedded
    expect(nodes[2].embedding).toBeDefined();
    expect(nodes[2].embedding!.length).toBeGreaterThan(0);
  });
});
