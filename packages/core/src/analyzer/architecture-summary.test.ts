import { describe, it, expect } from "vitest";
import { explainArchitecture } from "./architecture-summary.js";
import { detectArchitectureViolations } from "./architecture.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string, file: string, group: string): Node {
  return { id, label: file, type: "file", file, group };
}

function funcNode(id: string, file: string, group: string): Node {
  return { id, label: id, type: "function", file, group };
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

describe("explainArchitecture", () => {
  it("counts files and nodes per layer, correctly separating the two", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/List.tsx", "ui"), funcNode("a__f", "src/ui/List.tsx", "ui")],
      [],
    );
    const summary = explainArchitecture(graph);
    expect(summary.layers).toEqual([{ group: "ui", fileCount: 1, nodeCount: 1 }]);
  });

  it("aggregates imports edges by group pair, including self-pairs", () => {
    const graph = graphOf(
      [
        fileNode("a", "src/ui/A.tsx", "ui"),
        fileNode("b", "src/ui/B.tsx", "ui"),
        fileNode("c", "src/db/repo.ts", "repo"),
      ],
      [imports("a", "b"), imports("a", "c"), imports("b", "c")],
    );
    const summary = explainArchitecture(graph);
    expect(summary.layerDependencies).toContainEqual({ sourceGroup: "ui", targetGroup: "ui", importCount: 1 });
    expect(summary.layerDependencies).toContainEqual({ sourceGroup: "ui", targetGroup: "repo", importCount: 2 });
  });

  it("never counts non-imports edges toward layerDependencies", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/A.tsx", "ui"), funcNode("a__f", "src/ui/A.tsx", "ui")],
      [{ source: "a", target: "a__f", relation: "defines" }],
    );
    expect(explainArchitecture(graph).layerDependencies).toEqual([]);
  });

  it("omits a group with zero files entirely, not as fileCount: 0", () => {
    const graph = graphOf([fileNode("a", "src/ui/A.tsx", "ui")], []);
    const groups = explainArchitecture(graph).layers.map(l => l.group);
    expect(groups).not.toContain("repo");
  });

  it("leaves violations undefined when no rules are passed", () => {
    const graph = graphOf([fileNode("a", "src/ui/A.tsx", "ui")], []);
    expect(explainArchitecture(graph).violations).toBeUndefined();
  });

  it("returns violations (possibly empty) when rules are passed, matching detectArchitectureViolations directly", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/A.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [imports("a", "b")],
    );
    const rules = [{ from: "ui", to: "repo" }];
    const summary = explainArchitecture(graph, rules);
    expect(summary.violations).toEqual(detectArchitectureViolations(graph, rules));
    expect(summary.violations).toHaveLength(1);
  });

  it("returns an empty (not undefined) violations array when rules are passed but nothing violates them", () => {
    const graph = graphOf([fileNode("a", "src/ui/A.tsx", "ui")], []);
    expect(explainArchitecture(graph, [{ from: "ui", to: "repo" }]).violations).toEqual([]);
  });
});
