import { describe, it, expect } from "vitest";
import { rankByComplexity } from "./complexity.js";
import type { Graph, Node } from "../types.js";

function funcNode(id: string, complexity?: number, cognitiveComplexity?: number): Node {
  return {
    id,
    label: id,
    type: "function",
    file: `${id}.ts`,
    group: "other",
    ...(complexity !== undefined ? { complexity } : {}),
    ...(cognitiveComplexity !== undefined ? { cognitiveComplexity } : {}),
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

describe("rankByComplexity", () => {
  it("sorts scored nodes by complexity descending", () => {
    const graph = graphOf([funcNode("a", 2), funcNode("b", 10), funcNode("c", 5)]);
    const ranking = rankByComplexity(graph);
    expect(ranking.map(r => r.nodeId)).toEqual(["b", "c", "a"]);
  });

  it("excludes nodes with no complexity field", () => {
    const graph = graphOf([funcNode("a", 2), funcNode("b")]);
    const ranking = rankByComplexity(graph);
    expect(ranking.map(r => r.nodeId)).toEqual(["a"]);
  });

  it("respects options.threshold", () => {
    const graph = graphOf([funcNode("a", 2), funcNode("b", 10), funcNode("c", 5)]);
    const ranking = rankByComplexity(graph, { threshold: 5 });
    expect(ranking.map(r => r.nodeId)).toEqual(["b", "c"]);
  });

  it("returns [] when no node has a complexity field", () => {
    const graph = graphOf([funcNode("a"), funcNode("b")]);
    expect(rankByComplexity(graph)).toEqual([]);
  });

  it("defaults to the 'cyclomatic' metric, tagging each ranking entry", () => {
    const graph = graphOf([funcNode("a", 2)]);
    const ranking = rankByComplexity(graph);
    expect(ranking[0].metric).toBe("cyclomatic");
    expect(ranking[0].complexity).toBe(2);
  });

  it("ranks by cognitiveComplexity instead of complexity when metric: 'cognitive' is given", () => {
    // b has lower cyclomatic but higher cognitive — proves the two rankings
    // can genuinely disagree, the whole point of the second metric existing.
    const graph = graphOf([funcNode("a", 10, 2), funcNode("b", 3, 8)]);
    const ranking = rankByComplexity(graph, { metric: "cognitive" });
    expect(ranking.map(r => r.nodeId)).toEqual(["b", "a"]);
    expect(ranking.every(r => r.metric === "cognitive")).toBe(true);
    expect(ranking[0].complexity).toBe(8); // the cognitive value, in the same 'complexity' field
  });

  it("excludes a node with no cognitiveComplexity field when ranking by 'cognitive', even if it has complexity", () => {
    const graph = graphOf([funcNode("a", 5, 3), funcNode("b", 5)]);
    const ranking = rankByComplexity(graph, { metric: "cognitive" });
    expect(ranking.map(r => r.nodeId)).toEqual(["a"]);
  });
});
