import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Graph, Node } from "../types.js";

const decodeSpy = vi.fn();
vi.mock("../parser/similarity-signature.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parser/similarity-signature.js")>();
  return {
    ...actual,
    decodeSimilaritySignature: (sig: string) => {
      decodeSpy(sig);
      return actual.decodeSimilaritySignature(sig);
    },
  };
});

import { detectNearDuplicates, DEFAULT_NEAR_DUPLICATE_LIMIT } from "./near-duplicate.js";

function funcNode(id: string, similaritySignature?: string): Node {
  return {
    id,
    label: id,
    type: "function",
    file: `${id}.ts`,
    group: "other",
    ...(similaritySignature ? { similaritySignature } : {}),
  };
}

function graphOf(nodes: Node[]): Graph {
  return {
    project: "proj",
    stats: { files: 1, functions: nodes.length, classes: 0, interfaces: 0, edges: 0 },
    nodes,
    edges: [],
  };
}

/** Builds a well-formed hex signature from 32 explicit 16-bit lane values — full manual control over pairwise agreement, rather than relying on a real token stream's estimated similarity. */
function sig(values: number[]): string {
  if (values.length !== 32) throw new Error("expected exactly 32 lane values");
  return values.map(v => v.toString(16).padStart(4, "0")).join("");
}

const IDENTICAL = sig(Array.from({ length: 32 }, (_, i) => 1000 + i));

// A real "chain, not clique" fixture: A~B and B~C both estimate above the
// default 0.65 threshold, but A~C alone estimates well below it. Real
// end-to-end verification (spec 052) found this exact shape at real project
// scale merges thousands of unrelated functions into one meaningless group
// under single-linkage transitive closure — the quasi-clique semantic this
// spec settled on must NOT group all three together here.
const P = (i: number) => 1000 + i; // shared by A & B (lanes 0-20) and by all three (lanes 11-20)
const Q = (i: number) => 2000 + i; // shared by B & C (lanes 21-31)
const A_SIG = sig([...Array.from({ length: 21 }, (_, i) => P(i)), ...Array.from({ length: 11 }, (_, i) => 4000 + 21 + i)]);
const B_SIG = sig([...Array.from({ length: 21 }, (_, i) => P(i)), ...Array.from({ length: 11 }, (_, i) => Q(21 + i))]);
const C_SIG = sig([
  ...Array.from({ length: 11 }, (_, i) => 3000 + i),
  ...Array.from({ length: 10 }, (_, i) => P(11 + i)),
  ...Array.from({ length: 11 }, (_, i) => Q(21 + i)),
]);

// A real 3-way mutual clique: all three signatures agree on the same 22
// lanes and each carries its own unique values on the remaining 10 — every
// pair (not just a chain) estimates ~0.6875, above the default threshold.
const CLIQUE_SHARED = Array.from({ length: 22 }, (_, i) => 1000 + i);
const CLIQUE_A = sig([...CLIQUE_SHARED, ...Array.from({ length: 10 }, (_, i) => 2000 + i)]);
const CLIQUE_B = sig([...CLIQUE_SHARED, ...Array.from({ length: 10 }, (_, i) => 3000 + i)]);
const CLIQUE_C = sig([...CLIQUE_SHARED, ...Array.from({ length: 10 }, (_, i) => 4000 + i)]);

describe("detectNearDuplicates", () => {
  beforeEach(() => {
    decodeSpy.mockClear();
  });

  it("groups a simple pair with identical signatures", () => {
    const graph = graphOf([funcNode("a", IDENTICAL), funcNode("b", IDENTICAL)]);
    const result = detectNearDuplicates(graph);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["a", "b"]);
    expect(result.groups[0].minSimilarity).toBe(1);
    expect(result.groups[0].avgSimilarity).toBe(1);
  });

  it("does NOT chain a-c together via b — a chain is not a clique (spec 052's real-world fix)", () => {
    const graph = graphOf([funcNode("a", A_SIG), funcNode("b", B_SIG), funcNode("c", C_SIG)]);
    const result = detectNearDuplicates(graph, { threshold: 0.65 });
    // Only a-b (processed first, in node order) forms a group; c's only
    // qualifying neighbor (b) is already claimed, so c joins no group.
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["a", "b"]);
    expect(result.groups.flatMap(g => g.nodes.map(n => n.nodeId))).not.toContain("c");
  });

  it("groups a genuine 3-way mutual clique where every pair, not just a chain, clears the threshold", () => {
    const graph = graphOf([funcNode("a", CLIQUE_A), funcNode("b", CLIQUE_B), funcNode("c", CLIQUE_C)]);
    const result = detectNearDuplicates(graph, { threshold: 0.65 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["a", "b", "c"]);
    expect(result.groups[0].minSimilarity).toBeCloseTo(0.6875, 5);
    expect(result.groups[0].avgSimilarity).toBeCloseTo(0.6875, 5);
  });

  it("respects a custom threshold — raising it above the real pairwise similarity excludes the group", () => {
    const graph = graphOf([funcNode("a", A_SIG), funcNode("b", B_SIG), funcNode("c", C_SIG)]);
    const result = detectNearDuplicates(graph, { threshold: 0.7 });
    expect(result.groups).toEqual([]);
  });

  it("returns zero groups when nothing qualifies", () => {
    const graph = graphOf([funcNode("a"), funcNode("b"), funcNode("c", IDENTICAL)]); // c has no partner
    const result = detectNearDuplicates(graph);
    expect(result.groups).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("ignores nodes with no similaritySignature entirely", () => {
    const graph = graphOf([funcNode("a", IDENTICAL), funcNode("b", IDENTICAL), funcNode("c")]);
    const result = detectNearDuplicates(graph);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["a", "b"]);
  });

  it("respects limit and reports truncated when more groups exist than the limit allows", () => {
    // 6 disjoint identical-signature pairs -> 6 groups, each internally distinct via file to avoid cross-group collisions.
    const nodes: Node[] = [];
    for (let g = 0; g < 6; g++) {
      const groupSig = sig(Array.from({ length: 32 }, (_, i) => 9000 + g * 100 + i));
      nodes.push(funcNode(`g${g}a`, groupSig), funcNode(`g${g}b`, groupSig));
    }
    const graph = graphOf(nodes);
    const result = detectNearDuplicates(graph, { limit: 3 });
    expect(result.groups).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("defaults limit to DEFAULT_NEAR_DUPLICATE_LIMIT and is not truncated when groups fit", () => {
    const graph = graphOf([funcNode("a", IDENTICAL), funcNode("b", IDENTICAL)]);
    const result = detectNearDuplicates(graph);
    expect(result.groups.length).toBeLessThanOrEqual(DEFAULT_NEAR_DUPLICATE_LIMIT);
    expect(result.truncated).toBe(false);
  });

  it("sorts groups by size descending, then by average similarity descending", () => {
    const trioSig = (seed: number) => sig(Array.from({ length: 32 }, (_, i) => seed + i));
    const trio = trioSig(1000);
    const pair = trioSig(2000);
    const graph = graphOf([
      funcNode("p1", pair),
      funcNode("p2", pair),
      funcNode("t1", trio),
      funcNode("t2", trio),
      funcNode("t3", trio),
    ]);
    const result = detectNearDuplicates(graph);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["t1", "t2", "t3"]);
    expect(result.groups[1].nodes.map(n => n.nodeId)).toEqual(["p1", "p2"]);
  });

  it("produces deterministic member ordering (nodeId ascending) within a group", () => {
    const graph = graphOf([funcNode("z", IDENTICAL), funcNode("a", IDENTICAL), funcNode("m", IDENTICAL)]);
    const result = detectNearDuplicates(graph);
    expect(result.groups[0].nodes.map(n => n.nodeId)).toEqual(["a", "m", "z"]);
  });

  it("reports the effective threshold used, defaulting to the calibrated default", () => {
    const graph = graphOf([funcNode("a", IDENTICAL), funcNode("b", IDENTICAL)]);
    expect(detectNearDuplicates(graph).threshold).toBe(0.65);
    expect(detectNearDuplicates(graph, { threshold: 0.9 }).threshold).toBe(0.9);
  });

  it("decodes each signature exactly once, not per pair — the real perf lever, not the O(n²) pair count itself", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => funcNode(`n${i}`, sig(Array.from({ length: 32 }, (_, lane) => i * 100 + lane))));
    const graph = graphOf(nodes);
    detectNearDuplicates(graph);
    expect(decodeSpy).toHaveBeenCalledTimes(20);
  });
});
