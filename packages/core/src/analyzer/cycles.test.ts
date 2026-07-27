import { describe, it, expect } from "vitest";
import { detectCycles } from "./cycles.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string): Node {
  return { id, label: id, type: "file", file: `${id}.ts`, group: "other" };
}

function imports(source: string, target: string): Edge {
  return { source, target, relation: "imports" };
}

function graphOf(nodeIds: string[], edges: Edge[]): Graph {
  return {
    project: "proj",
    stats: { files: nodeIds.length, functions: 0, classes: 0, interfaces: 0, edges: edges.length },
    nodes: nodeIds.map(fileNode),
    edges,
  };
}

describe("detectCycles", () => {
  it("returns [] for an acyclic straight-line import chain", () => {
    const graph = graphOf(["a", "b", "c"], [imports("a", "b"), imports("b", "c")]);
    expect(detectCycles(graph)).toEqual([]);
  });

  it("returns [] for an acyclic tree-shaped import structure", () => {
    const graph = graphOf(
      ["a", "b", "c", "d"],
      [imports("a", "b"), imports("a", "c"), imports("b", "d")],
    );
    expect(detectCycles(graph)).toEqual([]);
  });

  it("finds a 2-file cycle", () => {
    const graph = graphOf(["a", "b"], [imports("a", "b"), imports("b", "a")]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].nodeIds.sort()).toEqual(["a", "b"]);
    expect(cycles[0].files.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("finds a 3+-file cycle", () => {
    const graph = graphOf(
      ["a", "b", "c"],
      [imports("a", "b"), imports("b", "c"), imports("c", "a")],
    );
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].nodeIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("finds a self-import as its own trivial cycle", () => {
    const graph = graphOf(["a", "b"], [imports("a", "a"), imports("a", "b")]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].nodeIds).toEqual(["a"]);
    expect(cycles[0].files).toEqual(["a.ts"]);
  });

  it("never includes a node with no incoming or outgoing imports edges in any cycle", () => {
    const graph = graphOf(
      ["a", "b", "isolated"],
      [imports("a", "b"), imports("b", "a")],
    );
    const cycles = detectCycles(graph);
    expect(cycles.flatMap(c => c.nodeIds)).not.toContain("isolated");
  });

  it("ignores non-imports edges entirely, however densely connected", () => {
    const graph = graphOf(
      ["a", "b", "c"],
      [
        { source: "a", target: "b", relation: "defines" },
        { source: "b", target: "c", relation: "extends" },
        { source: "c", target: "a", relation: "implements" },
      ],
    );
    expect(detectCycles(graph)).toEqual([]);
  });

  it("reports exactly one representative path per strongly-connected component, not every elementary cycle", () => {
    // A fully-connected 5-node SCC has many elementary cycles (many more than 5),
    // but should still collapse to a single reported cycle for that component.
    const ids = ["a", "b", "c", "d", "e"];
    const edges: Edge[] = [];
    for (const s of ids) for (const t of ids) if (s !== t) edges.push(imports(s, t));
    const graph = graphOf(ids, edges);

    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].nodeIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(cycles[0].nodeIds).size).toBe(cycles[0].nodeIds.length); // no repeats
  });

  it("detects multiple independent cycles as separate entries", () => {
    const graph = graphOf(
      ["a", "b", "x", "y"],
      [imports("a", "b"), imports("b", "a"), imports("x", "y"), imports("y", "x")],
    );
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(2);
  });
});
