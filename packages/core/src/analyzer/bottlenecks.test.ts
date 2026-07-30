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

  it("labels a widely-depended-upon but low-complexity shared type 'foundational', not 'high'", () => {
    // e.g. a Result monad / base use-case class: 12 dependents, complexity 2.
    const graph = graphOf(
      [fileNode("result"), funcNode("result__f", "result.ts", 2), fileNode("a")],
      [imports("a", "result")],
    );
    const ranking = findBottlenecks(graph);
    expect(ranking[0].risk).toBe("foundational");
  });

  it("labels a complex, heavily-depended-upon file 'high'", () => {
    const graph = graphOf(
      [fileNode("hub"), funcNode("hub__f", "hub.ts", 15), fileNode("a")],
      [imports("a", "hub")],
    );
    const ranking = findBottlenecks(graph);
    expect(ranking[0].risk).toBe("high");
  });

  it("labels a complex but undepended-upon file 'complex', not 'high'", () => {
    const graph = graphOf([fileNode("a"), funcNode("a__f", "a.ts", 15)], []);
    const ranking = findBottlenecks(graph);
    expect(ranking[0].risk).toBe("complex");
  });

  it("labels a simple, undepended-upon file 'low'", () => {
    const graph = graphOf([fileNode("a"), funcNode("a__f", "a.ts", 2)], []);
    const ranking = findBottlenecks(graph);
    expect(ranking[0].risk).toBe("low");
  });
});
