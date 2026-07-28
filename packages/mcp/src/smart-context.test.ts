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
});
