import { describe, it, expect } from "vitest";
import type { Graph } from "@caiquebrito/nodum-core";
import { codeLensesForFile } from "./code-lens.js";

const ROOT = "/proj";

describe("codeLensesForFile", () => {
  const graph: Graph = {
    project: "proj",
    stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 2 },
    nodes: [
      { id: "file-a", label: "a.ts", type: "file", file: "a.ts", group: "other" },
      { id: "callee", label: "callee", type: "function", file: "a.ts", group: "other", line: 1, complexity: 3 },
      { id: "caller1", label: "caller1", type: "function", file: "a.ts", group: "other", line: 5 },
      { id: "caller2", label: "caller2", type: "function", file: "a.ts", group: "other", line: 10 },
    ],
    edges: [
      { source: "caller1", target: "callee", relation: "calls" },
      { source: "caller2", target: "callee", relation: "calls" },
    ],
  };

  it("reports fan-in count and complexity when known, as the lens title", () => {
    const lenses = codeLensesForFile(ROOT, graph, `file://${ROOT}/a.ts`);
    const calleeLens = lenses.find((l) => l.command?.arguments?.[0] === "callee");
    expect(calleeLens?.command?.title).toBe("2 dependents · complexity 3");
  });

  it("uses singular 'dependent' for exactly one, and omits complexity when unset", () => {
    const lenses = codeLensesForFile(ROOT, graph, `file://${ROOT}/a.ts`);
    const callerLens = lenses.find((l) => l.command?.arguments?.[0] === "caller1");
    expect(callerLens?.command?.title).toBe("0 dependents");
  });

  it("wires the command to nodum.traceImpact with the node id as its argument", () => {
    const [lens] = codeLensesForFile(ROOT, graph, `file://${ROOT}/a.ts`);
    expect(lens.command?.command).toBe("nodum.traceImpact");
  });

  it("skips file nodes — they get diagnostics, not a code lens", () => {
    const lenses = codeLensesForFile(ROOT, graph, `file://${ROOT}/a.ts`);
    expect(lenses.some((l) => l.command?.arguments?.[0] === "file-a")).toBe(false);
  });
});
