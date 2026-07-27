import { describe, it, expect } from "vitest";
import { detectUnreachableFiles } from "./dead-code.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string, file: string, group = "other"): Node {
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

describe("detectUnreachableFiles", () => {
  it("reports a file with zero incoming imports, not matching any exclusion", () => {
    const graph = graphOf(
      [fileNode("a", "src/index.ts"), fileNode("b", "src/orphan.ts")],
      [],
    );
    const result = detectUnreachableFiles(graph);
    expect(result.map(f => f.file)).toContain("src/orphan.ts");
  });

  it("never reports a file with at least one incoming import", () => {
    const graph = graphOf(
      [fileNode("a", "src/entry.ts"), fileNode("b", "src/used.ts")],
      [imports("a", "b")],
    );
    const result = detectUnreachableFiles(graph);
    expect(result.map(f => f.file)).not.toContain("src/used.ts");
  });

  it("excludes files matching the default entry-point patterns", () => {
    const graph = graphOf(
      [
        fileNode("a", "src/index.ts"),
        fileNode("b", "src/main.js"),
        fileNode("c", "src/app.tsx"),
        fileNode("d", "src/server.ts"),
        fileNode("e", "src/cli.ts"),
        fileNode("f", "vite.config.ts"),
      ],
      [],
    );
    const result = detectUnreachableFiles(graph);
    expect(result).toEqual([]);
  });

  it("excludes files whose group is 'test'", () => {
    const graph = graphOf([fileNode("a", "src/foo.test.ts", "test")], []);
    expect(detectUnreachableFiles(graph)).toEqual([]);
  });

  it("merges custom entryPatterns with the built-in defaults rather than replacing them", () => {
    const graph = graphOf(
      [
        fileNode("a", "src/index.ts"), // excluded by default pattern
        fileNode("b", "src/pages/home.tsx"), // excluded only by custom pattern
        fileNode("c", "src/orphan.ts"), // still reported
      ],
      [],
    );
    const result = detectUnreachableFiles(graph, { entryPatterns: ["src/pages/**"] });
    expect(result.map(f => f.file)).toEqual(["src/orphan.ts"]);
  });

  it("returns [] when every file is reachable or excluded", () => {
    const graph = graphOf(
      [fileNode("a", "src/index.ts"), fileNode("b", "src/used.ts")],
      [imports("a", "b")],
    );
    expect(detectUnreachableFiles(graph)).toEqual([]);
  });
});
