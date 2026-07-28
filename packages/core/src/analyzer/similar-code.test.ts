import { describe, it, expect } from "vitest";
import { findSimilarCode } from "./similar-code.js";
import { detectDuplicates } from "./duplication.js";
import type { Graph, Node } from "../types.js";

function funcNode(id: string, duplicateHash?: string): Node {
  return { id, label: id, type: "function", file: `${id}.ts`, group: "other", ...(duplicateHash ? { duplicateHash } : {}) };
}

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
