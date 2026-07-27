import { describe, it, expect } from "vitest";
import { traceImpact } from "./impact.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string): Node {
  return { id, label: id, type: "file", file: `${id}.ts`, group: "other" };
}

function funcNode(id: string, file: string): Node {
  return { id, label: id, type: "function", file, group: "other" };
}

function imports(source: string, target: string): Edge {
  return { source, target, relation: "imports" };
}

function graphOf(nodes: Node[], edges: Edge[]): Graph {
  return {
    project: "proj",
    stats: { files: nodes.length, functions: 0, classes: 0, interfaces: 0, edges: edges.length },
    nodes,
    edges,
  };
}

describe("traceImpact", () => {
  it("returns [] for a file with no importers", () => {
    const graph = graphOf([fileNode("a")], []);
    expect(traceImpact(graph, "a")).toEqual([]);
  });

  it("returns a direct importer at distance 1", () => {
    const graph = graphOf([fileNode("a"), fileNode("b")], [imports("a", "b")]);
    const result = traceImpact(graph, "b");
    expect(result).toEqual([{ nodeId: "a", file: "a.ts", distance: 1 }]);
  });

  it("returns a transitive importer at distance 2", () => {
    // a imports b imports target(c)
    const graph = graphOf(
      [fileNode("a"), fileNode("b"), fileNode("c")],
      [imports("a", "b"), imports("b", "c")],
    );
    const result = traceImpact(graph, "c");
    expect(result).toContainEqual({ nodeId: "b", file: "b.ts", distance: 1 });
    expect(result).toContainEqual({ nodeId: "a", file: "a.ts", distance: 2 });
  });

  it("resolves a function node to its owning file before tracing", () => {
    const nodes = [fileNode("a"), fileNode("b"), funcNode("b__foo", "b.ts")];
    const graph = graphOf(nodes, [imports("a", "b")]);
    const fromFile = traceImpact(graph, "b");
    const fromFunction = traceImpact(graph, "b__foo");
    expect(fromFunction).toEqual(fromFile);
  });

  it("does not infinite-loop or duplicate on a real import cycle", () => {
    const graph = graphOf(
      [fileNode("a"), fileNode("b"), fileNode("c")],
      [imports("a", "b"), imports("b", "c"), imports("c", "a")],
    );
    const result = traceImpact(graph, "a");
    const ids = result.map(r => r.nodeId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids.sort()).toEqual(["b", "c"]);
  });

  it("respects options.maxDepth", () => {
    const graph = graphOf(
      [fileNode("a"), fileNode("b"), fileNode("c")],
      [imports("a", "b"), imports("b", "c")],
    );
    const result = traceImpact(graph, "c", { maxDepth: 1 });
    expect(result).toEqual([{ nodeId: "b", file: "b.ts", distance: 1 }]);
  });

  it("returns [] for a nonexistent node id", () => {
    const graph = graphOf([fileNode("a")], []);
    expect(traceImpact(graph, "nonexistent")).toEqual([]);
  });
});
