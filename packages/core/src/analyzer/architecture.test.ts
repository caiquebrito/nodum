import { describe, it, expect } from "vitest";
import { detectArchitectureViolations } from "./architecture.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string, file: string, group: string): Node {
  return { id, label: file, type: "file", file, group };
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

describe("detectArchitectureViolations", () => {
  it("flags an imports edge whose groups exactly match a declared rule", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/List.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [imports("a", "b")],
    );
    const violations = detectArchitectureViolations(graph, [{ from: "ui", to: "repo" }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ sourceFile: "src/ui/List.tsx", targetFile: "src/db/repo.ts" });
  });

  it("never flags an imports edge whose groups don't match any rule", () => {
    const graph = graphOf(
      [fileNode("a", "src/service/foo.ts", "service"), fileNode("b", "src/utils/bar.ts", "util")],
      [imports("a", "b")],
    );
    expect(detectArchitectureViolations(graph, [{ from: "ui", to: "repo" }])).toEqual([]);
  });

  it("a rule with to: '*' flags every outgoing edge from that group", () => {
    const graph = graphOf(
      [
        fileNode("a", "src/models/User.ts", "model"),
        fileNode("b", "src/service/foo.ts", "service"),
        fileNode("c", "src/utils/bar.ts", "util"),
      ],
      [imports("a", "b"), imports("a", "c")],
    );
    const violations = detectArchitectureViolations(graph, [{ from: "model", to: "*" }]);
    expect(violations).toHaveLength(2);
  });

  it("a rule with from: '*' flags every incoming edge into that group", () => {
    const graph = graphOf(
      [
        fileNode("a", "src/service/foo.ts", "service"),
        fileNode("b", "src/utils/bar.ts", "util"),
        fileNode("c", "src/db/repo.ts", "repo"),
      ],
      [imports("a", "c"), imports("b", "c")],
    );
    const violations = detectArchitectureViolations(graph, [{ from: "*", to: "repo" }]);
    expect(violations).toHaveLength(2);
  });

  it("returns [] when no rules are configured, even with many imports edges", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/List.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [imports("a", "b")],
    );
    expect(detectArchitectureViolations(graph, [])).toEqual([]);
  });

  it("never considers non-imports edges", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/List.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [{ source: "a", target: "b", relation: "defines" }],
    );
    expect(detectArchitectureViolations(graph, [{ from: "ui", to: "repo" }])).toEqual([]);
  });
});
