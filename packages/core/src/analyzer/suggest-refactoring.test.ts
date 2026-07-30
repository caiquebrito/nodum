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

function funcNode(id: string, file: string, opts: { complexity?: number; duplicateHash?: string; similaritySignature?: string } = {}): Node {
  return { id, label: id, type: "function", file, group: "other", ...opts };
}

const sig = (values: number[]) => values.map(v => v.toString(16).padStart(4, "0")).join("");
const IDENTICAL_SIG = sig(Array.from({ length: 32 }, (_, i) => 1000 + i));

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

  it("names the actual duplicated symbol(s) in the duplication description, not just a count", () => {
    const graph = graphOf(
      [
        fileNode("a", "a.ts"),
        { id: "a__extractId", label: "extractId", type: "function", file: "a.ts", group: "other", duplicateHash: "h1" },
        fileNode("b", "b.ts"),
        { id: "b__extractId", label: "extractId", type: "function", file: "b.ts", group: "other", duplicateHash: "h1" },
      ],
      [],
    );
    const dupSuggestions = suggestRefactoring(graph).filter(s => s.kind === "duplication");
    expect(dupSuggestions[0].description).toContain("extractId");
  });

  it("produces one near-duplication suggestion per fuzzy group, listing every member file (spec 052)", () => {
    const graph = graphOf(
      [
        fileNode("a", "a.ts"), funcNode("a__f", "a.ts", { similaritySignature: IDENTICAL_SIG }),
        fileNode("b", "b.ts"), funcNode("b__f", "b.ts", { similaritySignature: IDENTICAL_SIG }),
      ],
      [],
    );
    const suggestions = suggestRefactoring(graph);
    const nearDupSuggestions = suggestions.filter(s => s.kind === "near-duplication");
    expect(nearDupSuggestions).toHaveLength(1);
    expect(nearDupSuggestions[0].files.sort()).toEqual(["a.ts", "b.ts"]);
    expect(nearDupSuggestions[0].description).toContain("similar");
  });

  it("omits near-duplication when no fuzzy groups exist", () => {
    const graph = graphOf([fileNode("a", "index.ts")], []);
    expect(suggestRefactoring(graph).some(s => s.kind === "near-duplication")).toBe(false);
  });

  it("produces one dead-code suggestion per unreachable file", () => {
    const graph = graphOf([fileNode("a", "src/orphan.ts")], []);
    const suggestions = suggestRefactoring(graph);
    const deadSuggestions = suggestions.filter(s => s.kind === "dead-code");
    expect(deadSuggestions).toHaveLength(detectUnreachableFiles(graph).length);
    expect(deadSuggestions[0].files).toEqual(["src/orphan.ts"]);
  });

  it("excludes a file matching deadCodeEntryPatterns from the dead-code category", () => {
    const graph = graphOf([fileNode("a", "src/PokemonApplication.kt")], []);
    const withoutPattern = suggestRefactoring(graph).filter(s => s.kind === "dead-code");
    expect(withoutPattern).toHaveLength(1);

    const withPattern = suggestRefactoring(graph, {
      deadCodeEntryPatterns: ["src/PokemonApplication.kt"],
    }).filter(s => s.kind === "dead-code");
    expect(withPattern).toEqual([]);
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
    const order = ["cycle", "architecture-violation", "high-complexity", "duplication", "near-duplication", "dead-code"];
    const seenOrder = [...new Set(kinds)];
    expect(seenOrder).toEqual(order.filter(k => seenOrder.includes(k as any)));
  });
});
