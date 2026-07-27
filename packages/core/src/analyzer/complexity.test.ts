import { describe, it, expect } from "vitest";
import { rankByComplexity } from "./complexity.js";
import type { Graph, Node } from "../types.js";

function funcNode(id: string, complexity?: number): Node {
  return { id, label: id, type: "function", file: `${id}.ts`, group: "other", ...(complexity !== undefined ? { complexity } : {}) };
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
});
