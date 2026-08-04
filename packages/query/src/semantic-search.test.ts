import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  semanticScoreNodes,
  fuseByRRF,
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

  it("scores nodes by cosine similarity and sorts descending, including zero-similarity nodes", () => {
    const nodes = [
      { id: "a", label: "a", type: "function", embedding: [0, 1] },
      { id: "b", label: "b", type: "function", embedding: [1, 0] },
    ];
    const scored = semanticScoreNodes(queryEmbedding, nodes);

    expect(scored[0].node.id).toBe("b");
    // orthogonal -> score 0, but no longer filtered out (spec 066: nearly
    // every node has nonzero similarity with normalized embeddings, so the
    // old `> 0` filter barely filtered anything anyway).
    const orthogonal = scored.find((s) => s.node.id === "a");
    expect(orthogonal).toBeDefined();
    expect(orthogonal?.semanticScore).toBeCloseTo(0);
  });

  it("treats a missing embedding as score 0 but still includes it", () => {
    const nodes = [{ id: "a", label: "a", type: "function" }];
    const scored = semanticScoreNodes(queryEmbedding, nodes);
    expect(scored).toHaveLength(1);
    expect(scored[0].semanticScore).toBe(0);
  });

  it("bounds results to topK", () => {
    const nodes = [
      { id: "a", label: "a", type: "function", embedding: [1, 0] },
      { id: "b", label: "b", type: "function", embedding: [0.9, 0.1] },
      { id: "c", label: "c", type: "function", embedding: [0, 1] },
    ];
    const scored = semanticScoreNodes(queryEmbedding, nodes, 2);
    expect(scored).toHaveLength(2);
    expect(scored.map((s) => s.node.id)).toEqual(["a", "b"]);
  });
});

describe("fuseByRRF", () => {
  it("scores a node ranked #1 by both rankers higher than one ranked #1 by only one", () => {
    const scores = fuseByRRF([
      { nodeIds: ["a", "b"], weight: 0.4 },
      { nodeIds: ["a", "c"], weight: 0.6 },
    ]);

    expect(scores.get("a") ?? 0).toBeGreaterThan(scores.get("b") ?? 0);
    expect(scores.get("a") ?? 0).toBeGreaterThan(scores.get("c") ?? 0);
  });

  it("treats a node absent from a ranker's list as unranked (contributes 0), not rank 0", () => {
    const scores = fuseByRRF([
      { nodeIds: ["a"], weight: 0.4 },
      { nodeIds: ["b"], weight: 0.6 },
    ], 60);

    // "a" only ranked (1st) by the first, weight-0.4 ranker.
    expect(scores.get("a")).toBeCloseTo(0.4 / 61);
    // "b" only ranked (1st) by the second, weight-0.6 ranker.
    expect(scores.get("b")).toBeCloseTo(0.6 / 61);
  });

  it("uses the standard RRF formula: weight / (k + rank)", () => {
    const scores = fuseByRRF([{ nodeIds: ["x", "y", "z"], weight: 1 }], 60);
    expect(scores.get("x")).toBeCloseTo(1 / 61); // rank 1
    expect(scores.get("y")).toBeCloseTo(1 / 62); // rank 2
    expect(scores.get("z")).toBeCloseTo(1 / 63); // rank 3
  });
});

describe("mergeScores", () => {
  it("combines keyword and semantic rankings via RRF: rank #1 in both beats rank #1 in only one", () => {
    const semanticResults = [
      { node: { id: "a", label: "a", type: "function" }, semanticScore: 0.9, keywordScore: 0, finalScore: 0 },
      { node: { id: "b", label: "b", type: "function" }, semanticScore: 0.1, keywordScore: 0, finalScore: 0 },
    ];
    const keywordResults = [
      { id: "a", label: "a", type: "function" },
      { id: "c", label: "c", type: "function" },
    ];

    const merged = mergeScores(semanticResults, keywordResults);
    const byId = new Map(merged.map((m) => [m.node.id, m.finalScore]));

    expect(byId.get("a") ?? 0).toBeGreaterThan(byId.get("b") ?? 0);
    expect(byId.get("a") ?? 0).toBeGreaterThan(byId.get("c") ?? 0);
  });

  it("keeps a node found only by keyword search (unranked semantically), contributing 0 from the semantic side", () => {
    const semanticResults: never[] = [];
    const keywordResults = [{ id: "a", label: "a", type: "function" }];

    const merged = mergeScores(semanticResults, keywordResults);
    expect(merged).toHaveLength(1);
    expect(merged[0].node.id).toBe("a");
    expect(merged[0].finalScore).toBeCloseTo(0.4 / 61);
  });

  it("keeps a node found only by semantic search (zero lexical overlap), contributing 0 from the keyword side", () => {
    const semanticResults = [
      { node: { id: "a", label: "a", type: "function" }, semanticScore: 0.8, keywordScore: 0, finalScore: 0 },
    ];
    const keywordResults: { id: string; label: string; type: string }[] = [];

    const merged = mergeScores(semanticResults, keywordResults);
    expect(merged).toHaveLength(1);
    expect(merged[0].node.id).toBe("a");
    expect(merged[0].finalScore).toBeCloseTo(0.6 / 61);
  });

  it("heavier semantic weight favors a semantically-close-but-lexically-distant node over a keyword-only one", () => {
    const semanticResults = [
      { node: { id: "semantic-only", label: "semantic-only", type: "function" }, semanticScore: 0.95, keywordScore: 0, finalScore: 0 },
    ];
    const keywordResults = [{ id: "keyword-only", label: "keyword-only", type: "function" }];

    const balanced = mergeScores(semanticResults, keywordResults, 0.4, 0.6);
    const semanticHeavy = mergeScores(semanticResults, keywordResults, 0.1, 0.9);

    const balancedById = new Map(balanced.map((m) => [m.node.id, m.finalScore]));
    const semanticHeavyById = new Map(semanticHeavy.map((m) => [m.node.id, m.finalScore]));

    // Under balanced weights, semantic-only already edges out keyword-only (0.6/61 > 0.4/61).
    expect(balancedById.get("semantic-only") ?? 0).toBeGreaterThan(balancedById.get("keyword-only") ?? 0);
    // Under semantic-heavy weights, the gap widens further.
    const balancedGap = (balancedById.get("semantic-only") ?? 0) - (balancedById.get("keyword-only") ?? 0);
    const semanticHeavyGap = (semanticHeavyById.get("semantic-only") ?? 0) - (semanticHeavyById.get("keyword-only") ?? 0);
    expect(semanticHeavyGap).toBeGreaterThan(balancedGap);
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
