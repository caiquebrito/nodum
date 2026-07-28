import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  semanticScoreNodes,
  mergeScores,
  getTopScoredNodes,
  findSemanticNeighbors,
} from "./semantic-search.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 for mismatched vector lengths", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for undefined vectors instead of throwing", () => {
    expect(cosineSimilarity(undefined as any, [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], undefined as any)).toBe(0);
  });

  it("returns 0, not NaN, for a zero-magnitude vector", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("semanticScoreNodes", () => {
  const queryEmbedding = [1, 0];

  it("scores nodes by cosine similarity and sorts descending", () => {
    const nodes = [
      { id: "a", label: "a", type: "function", embedding: [0, 1] },
      { id: "b", label: "b", type: "function", embedding: [1, 0] },
    ];
    const scored = semanticScoreNodes(queryEmbedding, nodes);

    expect(scored[0].node.id).toBe("b");
    expect(scored.find((s) => s.node.id === "a")).toBeUndefined(); // orthogonal -> score 0, filtered out
  });

  it("treats a missing embedding as score 0 and filters it out", () => {
    const nodes = [{ id: "a", label: "a", type: "function" }];
    expect(semanticScoreNodes(queryEmbedding, nodes)).toEqual([]);
  });
});

describe("mergeScores", () => {
  it("combines keyword and semantic scores with the default 0.4/0.6 weights", () => {
    const scored = [
      { node: { id: "a", label: "a", type: "function" }, semanticScore: 0.5, keywordScore: 10, finalScore: 0 },
    ];
    const merged = mergeScores(scored);
    expect(merged[0].finalScore).toBeCloseTo(0.4 * 10 + 0.6 * 0.5);
  });

  it("respects custom weights", () => {
    const scored = [
      { node: { id: "a", label: "a", type: "function" }, semanticScore: 1, keywordScore: 1, finalScore: 0 },
    ];
    const merged = mergeScores(scored, 0.1, 0.9);
    expect(merged[0].finalScore).toBeCloseTo(0.1 + 0.9);
  });
});

describe("getTopScoredNodes", () => {
  it("sorts by finalScore and respects topK", () => {
    const scored = [
      { node: { id: "low", label: "low", type: "function" }, semanticScore: 0, keywordScore: 0, finalScore: 1 },
      { node: { id: "high", label: "high", type: "function" }, semanticScore: 0, keywordScore: 0, finalScore: 9 },
      { node: { id: "mid", label: "mid", type: "function" }, semanticScore: 0, keywordScore: 0, finalScore: 5 },
    ];
    const top = getTopScoredNodes(scored, 2);
    expect(top.map((n) => n.id)).toEqual(["high", "mid"]);
  });
});

describe("findSemanticNeighbors", () => {
  it("returns results unchanged (trimmed to targetCount) once the target is already met", () => {
    const results = [
      { id: "a", label: "a", type: "function" },
      { id: "b", label: "b", type: "function" },
    ];
    expect(findSemanticNeighbors(results, results, 1)).toEqual([results[0]]);
  });

  it("extends short results with the most similar remaining nodes by average embedding", () => {
    const results = [{ id: "a", label: "a", type: "function", embedding: [1, 0] }];
    const allNodes = [
      ...results,
      { id: "close", label: "close", type: "function", embedding: [0.9, 0.1] },
      { id: "far", label: "far", type: "function", embedding: [0, 1] },
    ];
    const extended = findSemanticNeighbors(results, allNodes, 2);

    expect(extended).toHaveLength(2);
    expect(extended[1].id).toBe("close");
  });

  it("returns results as-is when nothing has an embedding to extend with", () => {
    const results = [{ id: "a", label: "a", type: "function" }];
    const allNodes = [...results, { id: "b", label: "b", type: "function" }];
    expect(findSemanticNeighbors(results, allNodes, 5)).toEqual(results);
  });
});
