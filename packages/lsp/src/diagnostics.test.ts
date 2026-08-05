import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import type { Graph } from "@caiquebrito/nodum-core";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { computeDiagnostics } from "./diagnostics.js";

// A real, existing directory with no AndroidManifest.xml, no CI config, and
// no .nodumrc.json — findManifestEntryFiles/findCiInvokedFiles/
// loadArchitectureConfig all short-circuit to empty/no-op against it without
// needing to be mocked (verified against their own source: each catches or
// early-returns on "nothing found here").
const ROOT = tmpdir();

describe("computeDiagnostics", () => {
  it("reports a circular import as a warning on every file in the cycle", async () => {
    const graph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 2 },
      nodes: [
        { id: "a", label: "a.ts", type: "file", file: "a.ts", group: "other" },
        { id: "b", label: "b.ts", type: "file", file: "b.ts", group: "other" },
      ],
      edges: [
        { source: "a", target: "b", relation: "imports" },
        { source: "b", target: "a", relation: "imports" },
      ],
    };

    const byUri = await computeDiagnostics(ROOT, graph);
    expect(byUri.size).toBe(2);
    const aDiagnostics = byUri.get(`file://${ROOT}/a.ts`);
    expect(aDiagnostics).toHaveLength(1);
    expect(aDiagnostics?.[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(aDiagnostics?.[0].message).toMatch(/Circular import/);
    expect(aDiagnostics?.[0].source).toBe("nodum");
  });

  it("reports an unreachable file as dead code", async () => {
    const graph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: "entry", label: "index.ts", type: "file", file: "index.ts", group: "other" },
        { id: "orphan", label: "legacy.ts", type: "file", file: "legacy.ts", group: "other" },
      ],
      edges: [],
    };

    const byUri = await computeDiagnostics(ROOT, graph);
    const orphanDiagnostics = byUri.get(`file://${ROOT}/legacy.ts`);
    expect(orphanDiagnostics?.[0].message).toMatch(/Unreachable file/);
    // index.ts matches the built-in **/index.* entry-point pattern —
    // detectUnreachableFiles never flags it.
    expect(byUri.has(`file://${ROOT}/index.ts`)).toBe(false);
  });

  it("reports no diagnostics for a graph with no cycles, dead code, or architecture rules", async () => {
    const graph: Graph = {
      project: "proj",
      stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
      nodes: [
        { id: "a", label: "index.ts", type: "file", file: "index.ts", group: "other" },
        { id: "b", label: "b.ts", type: "file", file: "b.ts", group: "other" },
      ],
      edges: [{ source: "a", target: "b", relation: "imports" }],
    };

    const byUri = await computeDiagnostics(ROOT, graph);
    expect(byUri.size).toBe(0);
  });
});
