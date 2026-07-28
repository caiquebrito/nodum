import { describe, it, expect } from "vitest";
import { findBottlenecks } from "./bottlenecks.js";
import { traceImpact } from "./impact.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string): Node {
  return { id, label: id, type: "file", file: `${id}.ts`, group: "other" };
}

function funcNode(id: string, file: string, complexity: number): Node {
  return { id, label: id, type: "function", file, group: "other", complexity };
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

describe("findBottlenecks", () => {
  it("ranks a heavily-depended-upon complex file above an equally complex isolated file", () => {
    const graph = graphOf(
      [
        fileNode("popular"), funcNode("popular__f", "popular.ts", 10),
        fileNode("isolated"), funcNode("isolated__f", "isolated.ts", 10),
        fileNode("a"), fileNode("b"),
      ],
      [imports("a", "popular"), imports("b", "popular")],
    );
    const ranking = findBottlenecks(graph);
    expect(ranking[0].file).toBe("popular.ts");
    expect(ranking.find(b => b.file === "isolated.ts")!.dependentCount).toBe(0);
  });

  it("excludes a file with no scored functions entirely, not as score 0", () => {
    const graph = graphOf([fileNode("empty")], []);
    expect(findBottlenecks(graph)).toEqual([]);
  });

  it("uses the max complexity among a file's functions, not sum or average", () => {
    const graph = graphOf(
      [fileNode("a"), funcNode("a__low", "a.ts", 2), funcNode("a__high", "a.ts", 9)],
      [],
    );
    const ranking = findBottlenecks(graph);
    expect(ranking[0].maxComplexity).toBe(9);
  });

  it("respects options.limit", () => {
    const graph = graphOf(
      [
        fileNode("a"), funcNode("a__f", "a.ts", 5),
        fileNode("b"), funcNode("b__f", "b.ts", 3),
      ],
      [],
    );
    expect(findBottlenecks(graph, { limit: 1 })).toHaveLength(1);
  });

  it("dependentCount matches traceImpact's own count for the same file", () => {
    const graph = graphOf(
      [
        fileNode("target"), funcNode("target__f", "target.ts", 5),
        fileNode("a"), fileNode("b"),
      ],
      [imports("a", "target"), imports("b", "a")],
    );
    const ranking = findBottlenecks(graph);
    const targetFileNode = graph.nodes.find(n => n.file === "target.ts" && n.type === "file")!;
    expect(ranking[0].dependentCount).toBe(traceImpact(graph, targetFileNode.id).length);
  });
});
