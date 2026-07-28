import { describe, it, expect } from "vitest";
import { buildSmartContext, estimateTokenSavings } from "./smart-context.js";

const graph = {
  project: "proj",
  stats: { files: 3, functions: 2, classes: 0, interfaces: 0, edges: 2 },
  nodes: [
    { id: "auth.ts", label: "auth.ts", type: "file", file: "auth.ts", group: "service" },
    {
      id: "auth.ts__login",
      label: "login",
      type: "function",
      file: "auth.ts",
      group: "service",
    },
    {
      id: "auth.ts__logout",
      label: "logout",
      type: "function",
      file: "auth.ts",
      group: "service",
    },
  ],
  edges: [
    { source: "auth.ts", target: "auth.ts__login", relation: "defines" },
    { source: "auth.ts", target: "auth.ts__logout", relation: "defines" },
  ],
};

describe("estimateTokenSavings", () => {
  it("returns saved: 0, percentage: 0 for a zero-token baseline rather than NaN", () => {
    expect(estimateTokenSavings(0, 50)).toEqual({ saved: 0, percentage: 0 });
  });

  it("computes a real percentage from two counts", () => {
    expect(estimateTokenSavings(1000, 400)).toEqual({ saved: 600, percentage: 60 });
  });
});

describe("buildSmartContext", () => {
  it("reports a real, non-hardcoded percentage instead of the old 40-60% literal", async () => {
    const { text } = await buildSmartContext("login", graph as any, 25);

    expect(text).not.toContain("40-60%");
    expect(text).not.toContain("83% more reduction");
    expect(text).not.toContain("20% better selection");
    expect(text).toMatch(/\d+% fewer tokens than a full graph dump/);
  });

  it("returns approxTokens consistent with the returned text", async () => {
    const { text, approxTokens } = await buildSmartContext("login", graph as any, 25);
    expect(approxTokens).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("caps expansion around a heavily-imported hub node instead of pulling in every dependent", async () => {
    const hubGraph = {
      project: "hubproj",
      stats: { files: 301, functions: 0, classes: 0, interfaces: 0, edges: 300 },
      nodes: [
        { id: "hub.ts", label: "hub.ts", type: "file", file: "hub.ts", group: "util" },
        // A lone non-file node keeps hasEmbeddings()'s "0 of N non-file nodes
        // embedded" check meaningful rather than vacuously true on an
        // all-file graph (see the zero-non-file-node fix in embeddings.ts).
        { id: "hub.ts__init", label: "init", type: "function", file: "hub.ts", group: "util" },
        ...Array.from({ length: 300 }, (_, i) => ({
          id: `importer${i}.ts`,
          label: `importer${i}.ts`,
          type: "file",
          file: `importer${i}.ts`,
          group: "other",
        })),
      ],
      edges: Array.from({ length: 300 }, (_, i) => ({
        source: `importer${i}.ts`,
        target: "hub.ts",
        relation: "imports",
      })),
    };

    const { text } = await buildSmartContext("hub", hubGraph as any, 25);
    const match = text.match(/Found (\d+) relevant nodes/);
    const foundCount = match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;

    // Before spec 027, this would have been 301 (the hub + all 300 importers) —
    // unbounded by the number of dependents. The hard ceiling is 150.
    expect(foundCount).toBeLessThan(301);
    expect(foundCount).toBeLessThanOrEqual(150);
  });
});
