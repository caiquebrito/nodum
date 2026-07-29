import { describe, it, expect } from "vitest";
import { findSimilarCode, DEFAULT_SIMILARITY_THRESHOLD } from "./similar-code.js";
import { detectDuplicates } from "./duplication.js";
import { buildSimilaritySignature } from "../parser/similarity-signature.js";
import type { Graph, Node } from "../types.js";

function funcNode(id: string, duplicateHash?: string, similaritySignature?: string): Node {
  return {
    id,
    label: id,
    type: "function",
    file: `${id}.ts`,
    group: "other",
    ...(duplicateHash ? { duplicateHash } : {}),
    ...(similaritySignature ? { similaritySignature } : {}),
  };
}

// A small deterministic PRNG for reproducible synthetic token streams.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTokens(n: number, seed: number): string[] {
  const vocab = ["if_statement", "ID", "LIT", "for_statement", "call_expression", "binary_expression", "return_statement"];
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]);
}

const sigOf = (seed: number) => buildSimilaritySignature(randomTokens(60, seed))!;

function graphOf(nodes: Node[]): Graph {
  return {
    project: "proj",
    stats: { files: 1, functions: nodes.length, classes: 0, interfaces: 0, edges: 0 },
    nodes,
    edges: [],
  };
}

describe("findSimilarCode", () => {
  it("returns the other members of a node's duplicate group", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h1"), funcNode("c", "h2")]);
    const result = findSimilarCode(graph, "a");
    expect(result.matches.map(m => m.nodeId)).toEqual(["b"]);
  });

  it("returns [] for a node with a unique hash (no group partner)", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h2")]);
    expect(findSimilarCode(graph, "a").matches).toEqual([]);
  });

  it("returns [] for a node with no duplicateHash at all", () => {
    const graph = graphOf([funcNode("a"), funcNode("b", "h1"), funcNode("c", "h1")]);
    expect(findSimilarCode(graph, "a").matches).toEqual([]);
  });

  it("returns [] for a nonexistent node id", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h1")]);
    expect(findSimilarCode(graph, "nonexistent").matches).toEqual([]);
  });

  it("matches equal what detectDuplicates itself reports, minus the origin node", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h1"), funcNode("c", "h1")]);
    const result = findSimilarCode(graph, "a");
    const group = detectDuplicates(graph)[0];
    expect(result.matches.map(m => m.nodeId).sort()).toEqual(
      group.nodes.filter(n => n.nodeId !== "a").map(n => n.nodeId).sort(),
    );
  });
});

describe("findSimilarCode — fuzzy matching (spec 048)", () => {
  it("finds a fuzzy match via similaritySignature when no exact duplicateHash exists", () => {
    const sigA = sigOf(1);
    // Identical token stream -> identical signature -> similarity 1, well above the default threshold.
    const graph = graphOf([funcNode("a", undefined, sigA), funcNode("b", undefined, sigA)]);
    const result = findSimilarCode(graph, "a");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ nodeId: "b", kind: "fuzzy", similarity: 1 });
  });

  it("does not fuzzy-match two nodes with unrelated signatures", () => {
    const graph = graphOf([funcNode("a", undefined, sigOf(1)), funcNode("b", undefined, sigOf(999))]);
    expect(findSimilarCode(graph, "a").matches).toEqual([]);
  });

  it("respects a custom threshold, both raising and lowering it", () => {
    const sigA = sigOf(1);
    const sigB = sigOf(999);
    const graph = graphOf([funcNode("a", undefined, sigA), funcNode("b", undefined, sigB)]);
    // Unrelated signatures score ~0 — a threshold of 0 should still match everything with a signature.
    expect(findSimilarCode(graph, "a", { threshold: 0 }).matches.map(m => m.nodeId)).toEqual(["b"]);
    expect(findSimilarCode(graph, "a", { threshold: 0.9 }).matches).toEqual([]);
  });

  it("returns an empty result for a node with no similaritySignature and no duplicateHash", () => {
    const graph = graphOf([funcNode("a"), funcNode("b", undefined, sigOf(1))]);
    expect(findSimilarCode(graph, "a").matches).toEqual([]);
  });

  it("union with exact precedence: exact matches survive even when the origin node has no similaritySignature — the anti-regression case", () => {
    // A short-but-not-trivial body clears duplicateHash's floor but not
    // similaritySignature's stricter one — must still be found via the
    // exact path, exactly like before spec 048 existed.
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h1")]);
    const result = findSimilarCode(graph, "a");
    expect(result.matches).toEqual([{ nodeId: "b", label: "b", file: "b.ts", similarity: 1, kind: "exact" }]);
  });

  it("does not double-report a node matched both exactly and fuzzily — exact wins", () => {
    const sigA = sigOf(1);
    const graph = graphOf([
      funcNode("a", "h1", sigA),
      funcNode("b", "h1", sigA), // same hash AND same signature as a
    ]);
    const result = findSimilarCode(graph, "a");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].kind).toBe("exact");
  });

  it("sorts fuzzy matches by similarity descending, ties broken by nodeId", () => {
    const sigA = sigOf(1);
    const nearSig = buildSimilaritySignature([...randomTokens(60, 1).slice(0, -1), "PERTURBED"])!;
    const graph = graphOf([
      funcNode("a", undefined, sigA),
      funcNode("exact-ish", undefined, sigA),
      funcNode("near", undefined, nearSig),
    ]);
    const result = findSimilarCode(graph, "a", { threshold: 0 });
    expect(result.matches[0].nodeId).toBe("exact-ish"); // similarity 1, sorts first
  });

  it("respects the limit option", () => {
    const sigA = sigOf(1);
    const graph = graphOf([
      funcNode("a", undefined, sigA),
      funcNode("b", undefined, sigA),
      funcNode("c", undefined, sigA),
      funcNode("d", undefined, sigA),
    ]);
    const result = findSimilarCode(graph, "a", { limit: 2 });
    expect(result.matches).toHaveLength(2);
  });

  it("reports the effective threshold used, defaulting to DEFAULT_SIMILARITY_THRESHOLD", () => {
    const graph = graphOf([funcNode("a")]);
    expect(findSimilarCode(graph, "a").threshold).toBe(DEFAULT_SIMILARITY_THRESHOLD);
    expect(findSimilarCode(graph, "a", { threshold: 0.5 }).threshold).toBe(0.5);
  });
});
