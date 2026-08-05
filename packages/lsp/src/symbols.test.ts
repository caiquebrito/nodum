import { describe, it, expect } from "vitest";
import type { Graph } from "@caiquebrito/nodum-core";
import { SymbolKind } from "vscode-languageserver/node";
import { documentSymbols, workspaceSymbols } from "./symbols.js";

const ROOT = "/proj";

const graph: Graph = {
  project: "proj",
  stats: { files: 2, functions: 2, classes: 1, interfaces: 0, edges: 0 },
  nodes: [
    { id: "fa", label: "a.ts", type: "file", file: "a.ts", group: "other" },
    { id: "fb", label: "b.ts", type: "file", file: "b.ts", group: "other" },
    { id: "auth", label: "authenticateUser", type: "function", file: "a.ts", group: "other", line: 1 },
    { id: "cls", label: "UserService", type: "class", file: "a.ts", group: "other", line: 5 },
    { id: "other", label: "helper", type: "function", file: "b.ts", group: "other", line: 1 },
  ],
  edges: [],
};

describe("workspaceSymbols", () => {
  it("excludes file nodes and includes label, kind, and location", () => {
    const results = workspaceSymbols(ROOT, graph, "");
    expect(results.every((r) => r.name !== "a.ts" && r.name !== "b.ts")).toBe(true);
    const auth = results.find((r) => r.name === "authenticateUser");
    expect(auth?.kind).toBe(SymbolKind.Function);
    expect(auth?.location.uri).toBe(`file://${ROOT}/a.ts`);
    expect(auth?.containerName).toBe("a.ts");
  });

  it("filters by a case-insensitive substring match on the label", () => {
    const results = workspaceSymbols(ROOT, graph, "AUTH");
    expect(results.map((r) => r.name)).toEqual(["authenticateUser"]);
  });

  it("returns everything (still excluding files) for an empty query", () => {
    const results = workspaceSymbols(ROOT, graph, "   ");
    expect(results).toHaveLength(3);
  });

  it("caps results at 100", () => {
    const manyNodes: Graph["nodes"] = Array.from({ length: 150 }, (_, i) => ({
      id: `n${i}`,
      label: `fn${i}`,
      type: "function" as const,
      file: "a.ts",
      group: "other",
      line: i + 1,
    }));
    const bigGraph: Graph = { ...graph, nodes: manyNodes };
    expect(workspaceSymbols(ROOT, bigGraph, "")).toHaveLength(100);
  });
});

describe("documentSymbols", () => {
  it("returns only non-file nodes belonging to the requested document's file", () => {
    const results = documentSymbols(ROOT, graph, `file://${ROOT}/a.ts`);
    expect(results.map((r) => r.name).sort()).toEqual(["UserService", "authenticateUser"]);
  });

  it("returns an empty array for a file with no declarations in the graph", () => {
    const results = documentSymbols(ROOT, graph, `file://${ROOT}/missing.ts`);
    expect(results).toEqual([]);
  });
});
