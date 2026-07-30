import { describe, it, expect } from "vitest";
import { detectDuplicates } from "./duplication.js";
import type { Edge, Graph, Node } from "../types.js";

function funcNode(id: string, duplicateHash?: string): Node {
  return { id, label: id, type: "function", file: `${id}.ts`, group: "other", ...(duplicateHash ? { duplicateHash } : {}) };
}

function calls(source: string, target: string): Edge {
  return { source, target, relation: "calls" };
}

function graphOf(nodes: Node[], edges: Edge[] = []): Graph {
  return {
    project: "proj",
    stats: { files: 1, functions: nodes.length, classes: 0, interfaces: 0, edges: edges.length },
    nodes,
    edges,
  };
}

describe("detectDuplicates", () => {
  it("groups nodes sharing the same hash", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h1"), funcNode("c", "h2")]);
    const groups = detectDuplicates(graph);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodes.map(n => n.nodeId).sort()).toEqual(["a", "b"]);
  });

  it("excludes a hash with only one member", () => {
    const graph = graphOf([funcNode("a", "h1"), funcNode("b", "h2")]);
    expect(detectDuplicates(graph)).toEqual([]);
  });

  it("excludes nodes with no duplicateHash", () => {
    const graph = graphOf([funcNode("a"), funcNode("b")]);
    expect(detectDuplicates(graph)).toEqual([]);
  });

  it("returns [] when no node has a duplicateHash", () => {
    expect(detectDuplicates(graphOf([funcNode("a"), funcNode("b")]))).toEqual([]);
  });

  it("supports multiple independent duplicate groups", () => {
    const graph = graphOf([
      funcNode("a", "h1"),
      funcNode("b", "h1"),
      funcNode("c", "h2"),
      funcNode("d", "h2"),
    ]);
    expect(detectDuplicates(graph)).toHaveLength(2);
  });

  it("excludes a group whose members all delegate to the same shared helper", () => {
    const graph = graphOf(
      [funcNode("a", "h1"), funcNode("b", "h1"), funcNode("helper")],
      [calls("a", "helper"), calls("b", "helper")],
    );
    expect(detectDuplicates(graph)).toEqual([]);
  });

  it("still reports a group whose members call different helpers", () => {
    const graph = graphOf(
      [funcNode("a", "h1"), funcNode("b", "h1"), funcNode("helperA"), funcNode("helperB")],
      [calls("a", "helperA"), calls("b", "helperB")],
    );
    expect(detectDuplicates(graph)).toHaveLength(1);
  });

  it("still reports a group where only some members call a shared helper", () => {
    const graph = graphOf(
      [funcNode("a", "h1"), funcNode("b", "h1"), funcNode("helper")],
      [calls("a", "helper")],
    );
    expect(detectDuplicates(graph)).toHaveLength(1);
  });
});
