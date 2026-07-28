import { describe, it, expect } from "vitest";
import type { Graph } from "./types.js";
import { diffGraphs } from "./graph-diff.js";

function baseGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    project: "proj",
    stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 1 },
    nodes: [
      { id: "n1", label: "foo", type: "function", file: "a.ts", group: "other" },
      { id: "n2", label: "bar", type: "function", file: "b.ts", group: "other" },
    ],
    edges: [{ source: "n1", target: "n2", relation: "defines" }],
    ...overrides,
  };
}

describe("diffGraphs", () => {
  it("reports no differences for identical graphs", () => {
    const a = baseGraph();
    const b = baseGraph();

    const diff = diffGraphs(a, b);

    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual([]);
    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
    expect(diff.statsDelta).toEqual({ files: 0, functions: 0, classes: 0, interfaces: 0, edges: 0 });
  });

  it("classifies a node only in b as added, only in a as removed", () => {
    const a = baseGraph();
    const b = baseGraph({
      nodes: [
        a.nodes[0], // n1 unchanged
        { id: "n3", label: "baz", type: "function", file: "c.ts", group: "other" }, // new, replaces n2
      ],
    });

    const diff = diffGraphs(a, b);

    expect(diff.nodes.added.map(n => n.id)).toEqual(["n3"]);
    expect(diff.nodes.removed.map(n => n.id)).toEqual(["n2"]);
  });

  it("reports a node present in both with a different file as changed", () => {
    const a = baseGraph();
    const b = baseGraph({
      nodes: [a.nodes[0], { ...a.nodes[1], file: "moved.ts" }],
    });

    const diff = diffGraphs(a, b);

    expect(diff.nodes.changed).toHaveLength(1);
    expect(diff.nodes.changed[0]).toMatchObject({ id: "n2", changedFields: ["file"] });
  });

  it("does not report a node as changed when only clusterId/embedding differ", () => {
    const a = baseGraph({
      nodes: [
        { id: "n1", label: "foo", type: "function", file: "a.ts", group: "other", clusterId: "cluster_0" },
        baseGraph().nodes[1],
      ],
    });
    const b = baseGraph({
      nodes: [
        { id: "n1", label: "foo", type: "function", file: "a.ts", group: "other", clusterId: "cluster_5", embedding: [0.1, 0.2] },
        baseGraph().nodes[1],
      ],
    });

    const diff = diffGraphs(a, b);

    expect(diff.nodes.changed).toEqual([]);
  });

  it("is order-independent for edge added/removed detection", () => {
    const a = baseGraph({
      edges: [
        { source: "n1", target: "n2", relation: "defines" },
        { source: "n2", target: "n1", relation: "imports" },
      ],
    });
    const b = baseGraph({
      // same two edges, reversed order
      edges: [
        { source: "n2", target: "n1", relation: "imports" },
        { source: "n1", target: "n2", relation: "defines" },
      ],
    });

    const diff = diffGraphs(a, b);

    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
  });

  it("computes statsDelta as b - a, including negative deltas", () => {
    const a = baseGraph({ stats: { files: 5, functions: 10, classes: 3, interfaces: 1, edges: 8 } });
    const b = baseGraph({ stats: { files: 4, functions: 12, classes: 3, interfaces: 0, edges: 8 } });

    const diff = diffGraphs(a, b);

    expect(diff.statsDelta).toEqual({ files: -1, functions: 2, classes: 0, interfaces: -1, edges: 0 });
  });

  it("covers the spec-036 optional stats keys (struct/enum/protocol/extension) when both graphs have them", () => {
    const a = baseGraph({ stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0, structs: 1, enums: 0, protocols: 0, extensions: 0 } });
    const b = baseGraph({ stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0, structs: 2, enums: 1, protocols: 0, extensions: 0 } });

    const diff = diffGraphs(a, b);

    expect(diff.statsDelta.structs).toBe(1);
    expect(diff.statsDelta.enums).toBe(1);
    expect(diff.statsDelta.protocols).toBe(0);
    expect(diff.statsDelta.extensions).toBe(0);
  });

  it("treats a missing optional stats key (a pre-036 graph.json) as 0, not NaN", () => {
    // `a` here is shaped like a graph.json written before spec 036 — no
    // structs/enums/protocols/extensions keys at all.
    const a = baseGraph();
    const b = baseGraph({ stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 1, structs: 3 } });

    const diff = diffGraphs(a, b);

    expect(diff.statsDelta.structs).toBe(3);
    expect(Number.isNaN(diff.statsDelta.structs)).toBe(false);
  });
});
