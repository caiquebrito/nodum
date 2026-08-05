import { describe, it, expect } from "vitest";
import type { Graph } from "@caiquebrito/nodum-core";
import { referencesAt } from "./references.js";

const ROOT = "/proj";

describe("referencesAt", () => {
  const graph: Graph = {
    project: "proj",
    stats: { files: 2, functions: 3, classes: 0, interfaces: 0, edges: 2 },
    nodes: [
      { id: "target", label: "shared", type: "function", file: "a.ts", group: "other", line: 1 },
      { id: "callerSameFile", label: "callerSameFile", type: "function", file: "a.ts", group: "other", line: 5 },
      { id: "callerOtherFile", label: "callerOtherFile", type: "function", file: "b.ts", group: "other", line: 2 },
    ],
    edges: [
      { source: "callerSameFile", target: "target", relation: "calls" },
      { source: "callerOtherFile", target: "target", relation: "calls" },
    ],
  };

  it("returns every node whose edge targets the symbol at the given position, cross-file", () => {
    const locations = referencesAt(ROOT, graph, `file://${ROOT}/a.ts`, { line: 0, character: 0 }, false);
    const uris = locations.map((l) => l.uri).sort();
    expect(uris).toEqual([`file://${ROOT}/a.ts`, `file://${ROOT}/b.ts`]);
  });

  it("excludes the declaration itself unless includeDeclaration is set", () => {
    const withoutDecl = referencesAt(ROOT, graph, `file://${ROOT}/a.ts`, { line: 0, character: 0 }, false);
    expect(withoutDecl).toHaveLength(2);

    const withDecl = referencesAt(ROOT, graph, `file://${ROOT}/a.ts`, { line: 0, character: 0 }, true);
    expect(withDecl).toHaveLength(3);
  });

  it("returns an empty array when no node is found at the position", () => {
    const locations = referencesAt(ROOT, { ...graph, nodes: [] }, `file://${ROOT}/a.ts`, { line: 0, character: 0 }, false);
    expect(locations).toEqual([]);
  });
});
