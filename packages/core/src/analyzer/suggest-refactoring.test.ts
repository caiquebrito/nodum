import { describe, it, expect } from "vitest";
import { suggestRefactoring } from "./suggest-refactoring.js";
import { detectCycles } from "./cycles.js";
import { detectArchitectureViolations } from "./architecture.js";
import { detectDuplicates } from "./duplication.js";
import { detectUnreachableFiles } from "./dead-code.js";
import type { Graph, Node, Edge } from "../types.js";

function fileNode(id: string, file: string, group = "other"): Node {
  return { id, label: file, type: "file", file, group };
}

function funcNode(id: string, file: string, opts: { complexity?: number; duplicateHash?: string } = {}): Node {
  return { id, label: id, type: "function", file, group: "other", ...opts };
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

describe("suggestRefactoring", () => {
  it("returns [] for a project with no issues in any category", () => {
    const graph = graphOf([fileNode("a", "index.ts")], []);
    expect(suggestRefactoring(graph)).toEqual([]);
  });

  it("produces a cycle suggestion matching detectCycles' own output", () => {
    const graph = graphOf(
      [fileNode("a", "a.ts"), fileNode("b", "b.ts")],
      [imports("a", "b"), imports("b", "a")],
    );
    const suggestions = suggestRefactoring(graph);
    const cycleSuggestions = suggestions.filter(s => s.kind === "cycle");
    expect(cycleSuggestions).toHaveLength(detectCycles(graph).length);
    expect(cycleSuggestions[0].files.sort()).toEqual(detectCycles(graph)[0].files.sort());
  });

  it("omits architecture-violation entirely when no rules are configured", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/A.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [imports("a", "b")],
    );
    expect(suggestRefactoring(graph).some(s => s.kind === "architecture-violation")).toBe(false);
  });

  it("produces architecture-violation suggestions matching detectArchitectureViolations when rules are given", () => {
    const graph = graphOf(
      [fileNode("a", "src/ui/A.tsx", "ui"), fileNode("b", "src/db/repo.ts", "repo")],
      [imports("a", "b")],
    );
    const rules = [{ from: "ui", to: "repo" }];
    const suggestions = suggestRefactoring(graph, { architectureRules: rules });
    const violationSuggestions = suggestions.filter(s => s.kind === "architecture-violation");
    expect(violationSuggestions).toHaveLength(detectArchitectureViolations(graph, rules).length);
  });

  it("flags a function at or above the complexity threshold, not below it", () => {
    const graph = graphOf(
      [fileNode("f", "f.ts"), funcNode("f__high", "f.ts", { complexity: 10 }), funcNode("f__low", "f.ts", { complexity: 9 })],
      [],
    );
    const suggestions = suggestRefactoring(graph);
    const complexitySuggestions = suggestions.filter(s => s.kind === "high-complexity");
    expect(complexitySuggestions).toHaveLength(1);
    expect(complexitySuggestions[0].description).toContain("f__high");
  });

  it("respects a custom complexityThreshold", () => {
    const graph = graphOf([fileNode("f", "f.ts"), funcNode("f__mid", "f.ts", { complexity: 5 })], []);
    expect(suggestRefactoring(graph).filter(s => s.kind === "high-complexity")).toHaveLength(0);
    expect(suggestRefactoring(graph, { complexityThreshold: 5 }).filter(s => s.kind === "high-complexity")).toHaveLength(1);
  });

  it("produces one duplication suggestion per group, listing every member file", () => {
    const graph = graphOf(
      [
        fileNode("a", "a.ts"), funcNode("a__f", "a.ts", { duplicateHash: "h1" }),
        fileNode("b", "b.ts"), funcNode("b__f", "b.ts", { duplicateHash: "h1" }),
      ],
      [],
    );
    const suggestions = suggestRefactoring(graph);
    const dupSuggestions = suggestions.filter(s => s.kind === "duplication");
    expect(dupSuggestions).toHaveLength(detectDuplicates(graph).length);
    expect(dupSuggestions[0].files.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("produces one dead-code suggestion per unreachable file", () => {
    const graph = graphOf([fileNode("a", "src/orphan.ts")], []);
    const suggestions = suggestRefactoring(graph);
    const deadSuggestions = suggestions.filter(s => s.kind === "dead-code");
    expect(deadSuggestions).toHaveLength(detectUnreachableFiles(graph).length);
    expect(deadSuggestions[0].files).toEqual(["src/orphan.ts"]);
  });

  it("groups suggestions in the fixed category order", () => {
    const graph = graphOf(
      [
        fileNode("a", "a.ts"), fileNode("b", "b.ts"),
        funcNode("a__f", "a.ts", { complexity: 12 }),
        fileNode("orphan", "orphan.ts"),
      ],
      [imports("a", "b"), imports("b", "a")],
    );
    const kinds = suggestRefactoring(graph).map(s => s.kind);
    const order = ["cycle", "architecture-violation", "high-complexity", "duplication", "dead-code"];
    const seenOrder = [...new Set(kinds)];
    expect(seenOrder).toEqual(order.filter(k => seenOrder.includes(k as any)));
  });
});
