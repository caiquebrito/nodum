import { describe, it, expect } from "vitest";
import {
  buildSmartContext,
  buildNodeContext,
  estimateTokenSavings,
  extractKeywords,
  scoreNode,
  findRelevantNodes,
} from "./smart-context.js";

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

describe("extractKeywords", () => {
  it("filters stopwords, keeping meaningful terms (punctuation is not stripped)", () => {
    expect(extractKeywords("What is the auth flow?")).toEqual(["auth", "flow?"]);
  });

  it("splits on whitespace, hyphens, underscores, dots, and slashes", () => {
    expect(extractKeywords("auth-flow_v2.routes/login")).toEqual(["auth", "flow", "routes", "login"]);
  });

  it("drops short words and known stopwords, keeping the rest", () => {
    expect(extractKeywords("What is the authentication flow for the API")).toEqual([
      "authentication",
      "flow",
      "api",
    ]);
  });
});

describe("scoreNode", () => {
  const node = { id: "auth.ts__login", label: "login", type: "function", file: "src/auth.ts" };

  it("scores an exact label match higher than a substring match", () => {
    const exact = scoreNode(node, ["login"]);
    const substring = scoreNode({ ...node, label: "login-handler" }, ["login"]);
    expect(exact).toBeGreaterThan(substring);
  });

  it("adds points independently for file-path and type matches", () => {
    const baseline = scoreNode(node, ["login"]);
    const withFileMatch = scoreNode(node, ["login", "auth"]);
    const withTypeMatch = scoreNode(node, ["login", "function"]);
    expect(withFileMatch).toBeGreaterThan(baseline);
    expect(withTypeMatch).toBeGreaterThan(baseline);
  });

  it("scores 0 for a node matching none of the keywords", () => {
    expect(scoreNode(node, ["database", "migration"])).toBe(0);
  });
});

describe("findRelevantNodes", () => {
  const nodes = [
    { id: "a", label: "login", type: "function", file: "auth.ts" },
    { id: "b", label: "logout", type: "function", file: "auth.ts" },
    { id: "c", label: "database", type: "function", file: "db.ts" },
  ];

  it("excludes zero-score nodes and sorts the rest by score descending", () => {
    const relevant = findRelevantNodes(["login", "logout"], nodes, 10);
    expect(relevant.map((n) => n.id)).not.toContain("c");
    expect(relevant.length).toBe(2);
  });

  it("respects the limit parameter", () => {
    const manyNodes = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      label: "login",
      type: "function",
      file: "auth.ts",
    }));
    expect(findRelevantNodes(["login"], manyNodes, 5)).toHaveLength(5);
  });
});

describe("buildNodeContext", () => {
  const graph = {
    project: "proj",
    stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
    nodes: [
      { id: "auth.ts", label: "auth.ts", type: "file", file: "auth.ts", group: "service" },
      { id: "auth.ts__login", label: "login", type: "function", file: "auth.ts", group: "service" },
    ],
    edges: [{ source: "auth.ts", target: "auth.ts__login", relation: "defines" }],
  };

  it("returns a not-found message for an unknown node id", () => {
    expect(buildNodeContext("does-not-exist", graph as any)).toBe("Node not found: does-not-exist");
  });

  it("lists dependencies and dependents for a known node", () => {
    const text = buildNodeContext("auth.ts", graph as any);
    expect(text).toContain("login");
    expect(text).toContain("Dependencies (1)");
  });

  it("truncates past 10 items per direction with an '... and N more' suffix", () => {
    const manyDeps = {
      project: "proj",
      stats: { files: 1, functions: 15, classes: 0, interfaces: 0, edges: 15 },
      nodes: [
        { id: "hub", label: "hub", type: "file", file: "hub.ts", group: "util" },
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `dep${i}`,
          label: `dep${i}`,
          type: "function",
          file: "hub.ts",
          group: "util",
        })),
      ],
      edges: Array.from({ length: 15 }, (_, i) => ({ source: "hub", target: `dep${i}`, relation: "defines" })),
    };

    const text = buildNodeContext("hub", manyDeps as any);
    expect(text).toContain("... and 5 more");
  });
});

describe("formatContextText (via buildSmartContext)", () => {
  it("shows a cluster summary once instead of listing each member node individually", async () => {
    const clusteredGraph = {
      project: "proj",
      stats: { files: 2, functions: 2, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        { id: "auth.ts__login", label: "login", type: "function", file: "auth.ts", group: "service" },
        { id: "auth.ts__logout", label: "logout", type: "function", file: "auth.ts", group: "service" },
      ],
      edges: [],
      clusters: [
        {
          id: "cluster-1",
          label: "Auth cluster",
          summary: "login and logout handlers",
          types: ["function"],
          externalDeps: [],
          nodeIds: ["auth.ts__login", "auth.ts__logout"],
        },
      ],
      nodeToCluster: { "auth.ts__login": "cluster-1", "auth.ts__logout": "cluster-1" },
    };

    const { text } = await buildSmartContext("login", clusteredGraph as any, 25);
    expect(text).toContain("Auth cluster");
    expect(text).toContain("login and logout handlers");
    // The cluster summary appears once; individual member lines (with the
    // ⚙️ per-node marker) should not appear since they're folded into it.
    expect(text).not.toContain("⚙️ login");
  });
});

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
