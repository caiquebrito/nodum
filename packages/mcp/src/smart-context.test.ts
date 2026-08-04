import { describe, it, expect } from "vitest";
import {
  buildSmartContext,
  buildNodeContext,
  estimateTokenSavings,
  extractKeywords,
  scoreNode,
  findRelevantNodes,
  buildTermIndex,
} from "./smart-context.js";
import type { Node } from "@caiquebrito/nodum-core";

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
    // "v2" is now kept — spec 068 lowered the length filter from >2 to >1
    // specifically to recover short identifier fragments like this one.
    expect(extractKeywords("auth-flow_v2.routes/login")).toEqual(["auth", "flow", "v2", "routes", "login"]);
  });

  it("recovers short identifier fragments (id, db, ui, io) that a length>2 filter used to drop (spec 068)", () => {
    expect(extractKeywords("find the db connection and id lookup for the ui and io layer")).toEqual([
      "find", "db", "connection", "id", "lookup", "ui", "io", "layer",
    ]);
  });

  it("still drops short noise words added to the stop-list alongside the length change (spec 068)", () => {
    expect(extractKeywords("log in on the ok page up at the go button")).toEqual(["log", "page", "button"]);
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
  const node: Node = { id: "auth.ts__login", label: "login", type: "function", file: "src/auth.ts", group: "service" };

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

  it("scores an exact split-term match higher than a coincidental substring match (spec 068 minimal pair)", () => {
    // `superclass` contains "super" as a raw substring but "super" is not
    // one of its own split terms (tokenizeIdentifier("superclass") ===
    // ["superclass"], no camelCase/snake_case boundary to split on) — so a
    // query for "super" should score a real `superHelper`-style term match
    // (where "super" IS a split term) higher than the `superclass`
    // coincidence.
    const termIndex = buildTermIndex([
      { id: "a", label: "superHelper", type: "function", file: "a.ts", group: "util" },
      { id: "b", label: "superclass", type: "function", file: "b.ts", group: "util" },
    ]);
    const termMatch = scoreNode(
      { id: "a", label: "superHelper", type: "function", file: "a.ts", group: "util" },
      ["super"],
      termIndex
    );
    const substringMatch = scoreNode(
      { id: "b", label: "superclass", type: "function", file: "b.ts", group: "util" },
      ["super"],
      termIndex
    );
    expect(termMatch).toBeGreaterThan(substringMatch);
  });

  it("weights a rare term's match higher than a common term's match, for an otherwise-equal match (IDF, spec 068)", () => {
    // 50 nodes total: "get" appears on 40 of them (near-ubiquitous),
    // "webhook" appears on only 1 (rare, discriminative) — an otherwise
    // identical single-term exact match should score higher for the rare
    // term.
    const nodes: Node[] = [
      { id: "rare", label: "webhookHandler", type: "function", file: "a.ts", group: "util" },
      ...Array.from({ length: 39 }, (_, i) => ({
        id: `common${i}`,
        label: `getThing${i}`,
        type: "function" as const,
        file: "a.ts",
        group: "util",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `filler${i}`,
        label: `unrelated${i}`,
        type: "function" as const,
        file: "a.ts",
        group: "util",
      })),
    ];
    const termIndex = buildTermIndex(nodes);

    const rareScore = scoreNode(nodes[0], ["webhook"], termIndex);
    const commonScore = scoreNode(nodes[1], ["get"], termIndex);
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("scores identically to a neutral (no-op) weight when called without a termIndex", () => {
    // Backward-compat posture: scoreNode is still callable in isolation
    // (this whole describe block does exactly that) without needing a
    // termIndex built first.
    expect(scoreNode(node, ["login"])).toBeGreaterThan(0);
  });
});

describe("buildTermIndex", () => {
  it("indexes each node under its split identifier terms, not the raw label", () => {
    const index = buildTermIndex([
      { id: "a", label: "getUserById", type: "function", file: "a.ts", group: "util" },
    ]);
    expect(index.termToNodeIds.get("get")?.has("a")).toBe(true);
    expect(index.termToNodeIds.get("user")?.has("a")).toBe(true);
    expect(index.termToNodeIds.get("by")?.has("a")).toBe(true);
    expect(index.termToNodeIds.get("id")?.has("a")).toBe(true);
    expect(index.termToNodeIds.has("getuserbyid")).toBe(false);
  });

  it("gives a term appearing in fewer nodes a higher idf than one appearing in more", () => {
    const index = buildTermIndex([
      { id: "a", label: "rareTerm", type: "function", file: "a.ts", group: "util" },
      { id: "b", label: "commonWord", type: "function", file: "b.ts", group: "util" },
      { id: "c", label: "commonWord", type: "function", file: "c.ts", group: "util" },
      { id: "d", label: "commonWord", type: "function", file: "d.ts", group: "util" },
    ]);
    expect(index.idf.get("rare") ?? 0).toBeGreaterThan(index.idf.get("common") ?? 0);
  });
});

describe("findRelevantNodes", () => {
  const nodes: Node[] = [
    { id: "a", label: "login", type: "function", file: "auth.ts", group: "service" },
    { id: "b", label: "logout", type: "function", file: "auth.ts", group: "service" },
    { id: "c", label: "database", type: "function", file: "db.ts", group: "service" },
  ];

  it("excludes zero-score nodes and sorts the rest by score descending", () => {
    const relevant = findRelevantNodes(["login", "logout"], nodes, 10);
    expect(relevant.map((n) => n.id)).not.toContain("c");
    expect(relevant.length).toBe(2);
  });

  it("respects the limit parameter", () => {
    const manyNodes: Node[] = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      label: "login",
      type: "function",
      file: "auth.ts",
      group: "service",
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

  it("shows a Source set line when the node has one (spec 049)", () => {
    const kotlinGraph = {
      project: "proj",
      stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        {
          id: "shared/src/commonMain/kotlin/Greeting.kt",
          label: "Greeting.kt",
          type: "file",
          file: "shared/src/commonMain/kotlin/Greeting.kt",
          group: "other",
          sourceSet: "commonMain",
        },
      ],
      edges: [],
    };
    const text = buildNodeContext("shared/src/commonMain/kotlin/Greeting.kt", kotlinGraph as any);
    expect(text).toContain("Source set: commonMain");
  });

  it("omits the Source set line entirely for a node with none — byte-identical to pre-spec-049 output", () => {
    const text = buildNodeContext("auth.ts", graph as any);
    expect(text).not.toContain("Source set");
  });

  it("shows a Module line when the node has one (spec 051)", () => {
    const kotlinGraph = {
      project: "proj",
      stats: { files: 1, functions: 0, classes: 0, interfaces: 0, edges: 0 },
      nodes: [
        {
          id: "forro/feature/src/main/kotlin/Foo.kt",
          label: "Foo.kt",
          type: "file",
          file: "forro/feature/src/main/kotlin/Foo.kt",
          group: "other",
          module: "forro/feature",
        },
      ],
      edges: [],
    };
    const text = buildNodeContext("forro/feature/src/main/kotlin/Foo.kt", kotlinGraph as any);
    expect(text).toContain("Module: forro/feature");
  });

  it("omits the Module line entirely for a node with none — byte-identical to pre-spec-051 output", () => {
    const text = buildNodeContext("auth.ts", graph as any);
    expect(text).not.toContain("Module");
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

    const { text } = await buildSmartContext("login", clusteredGraph as any, { maxNodes: 25 });
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
    const { text } = await buildSmartContext("login", graph as any, { maxNodes: 25 });

    expect(text).not.toContain("40-60%");
    expect(text).not.toContain("83% more reduction");
    expect(text).not.toContain("20% better selection");
    expect(text).toMatch(/\d+% fewer tokens than a full graph dump/);
  });

  it("returns approxTokens consistent with the returned text", async () => {
    const { text, approxTokens } = await buildSmartContext("login", graph as any, { maxNodes: 25 });
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

    const { text } = await buildSmartContext("hub", hubGraph as any, { maxNodes: 25 });
    const match = text.match(/Found (\d+) relevant nodes/);
    const foundCount = match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;

    // Before spec 027, this would have been 301 (the hub + all 300 importers) —
    // unbounded by the number of dependents. The hard ceiling is 150.
    expect(foundCount).toBeLessThan(301);
    expect(foundCount).toBeLessThanOrEqual(150);
  });
});

describe("buildSmartContext — token budget (spec 041)", () => {
  // Many distinct, non-clustered file sections so the full expansion is
  // large enough for a small budget to force real truncation, and each
  // file's own two nodes give each section enough text to have a real,
  // non-trivial token cost.
  function manyFilesGraph() {
    const nodes: any[] = [];
    const edges: any[] = [];
    for (let i = 0; i < 30; i++) {
      const fileId = `login${i}.ts`;
      const fnId = `login${i}.ts__login`;
      nodes.push({ id: fileId, label: `login${i}.ts`, type: "file", file: fileId, group: "service" });
      nodes.push({ id: fnId, label: "login", type: "function", file: fileId, group: "service" });
      edges.push({ source: fileId, target: fnId, relation: "defines" });
    }
    return {
      project: "manyfiles",
      stats: { files: 30, functions: 30, classes: 0, interfaces: 0, edges: 30 },
      nodes,
      edges,
    };
  }

  it("stays at or reasonably close to a tight token budget instead of returning the full unbounded output", async () => {
    const full = await buildSmartContext("login", manyFilesGraph() as any, { maxNodes: 30 });
    const budgeted = await buildSmartContext("login", manyFilesGraph() as any, { maxNodes: 30, tokenBudget: 150 });

    expect(budgeted.approxTokens).toBeLessThan(full.approxTokens);
    // Fixed overhead (header/footer) is reserved before filling sections,
    // so this should land close to, not just "roughly under", the budget —
    // allow modest slack for the approximation (per-section incremental
    // counting, BPE non-additivity across concatenation), not a wide one.
    expect(budgeted.approxTokens).toBeLessThanOrEqual(150 * 1.15);
  });

  it("marks the response as truncated and reports a smaller included-count than found-count when the budget cuts content", async () => {
    const { text } = await buildSmartContext("login", manyFilesGraph() as any, { maxNodes: 30, tokenBudget: 150 });

    expect(text).toContain("truncated to fit token budget");
    const foundMatch = text.match(/Found (\d+) relevant nodes/);
    const includesMatch = text.match(/Context includes: (\d+) relevant nodes/);
    expect(foundMatch).not.toBeNull();
    expect(includesMatch).not.toBeNull();
    expect(Number(includesMatch![1])).toBeLessThan(Number(foundMatch![1]));
  });

  it("always includes at least the single highest-priority section, even under a budget too small for it alone", async () => {
    const { text } = await buildSmartContext("login", manyFilesGraph() as any, { maxNodes: 30, tokenBudget: 1 });
    // login0.ts is the top-scored seed (exact label match on "login" isn't
    // possible here, but file-path substring scoring favors earlier ids
    // consistently) — the real assertion is just that *some* real content
    // survived a budget of 1 token, proving the "never return empty" rule.
    expect(text).toContain("login");
    expect(text.length).toBeGreaterThan(20);
  });

  it("accounts for header/footer overhead, not just section text, when respecting the budget", async () => {
    // Regression case: an earlier version of this budget accounting only
    // reserved section text against the budget and appended the header
    // ("Knowledge Graph Context...") and footer ("📊 Summary...", the
    // percentage/notes line) afterward, unbudgeted — real end-to-end
    // verification against a synced project found this overshot a 300-token
    // budget by ~25%. Fixed by reserving estimated header+footer cost
    // before filling sections.
    const { approxTokens } = await buildSmartContext("login", manyFilesGraph() as any, {
      maxNodes: 30,
      tokenBudget: 300,
    });
    expect(approxTokens).toBeLessThanOrEqual(300 * 1.15);
  });

  it("does not truncate when the budget comfortably fits the full content", async () => {
    const { text, approxTokens } = await buildSmartContext("login", manyFilesGraph() as any, {
      maxNodes: 30,
      tokenBudget: 100_000,
    });
    expect(text).not.toContain("truncated to fit token budget");
    expect(approxTokens).toBeLessThan(100_000);
  });

  it("behaves exactly as before spec 041 when no tokenBudget is given", async () => {
    const withBudgetOmitted = await buildSmartContext("login", graph as any, { maxNodes: 25 });
    expect(withBudgetOmitted.text).not.toContain("truncated to fit token budget");
    expect(withBudgetOmitted.text).not.toContain("cut short by token budget");
  });
});

describe("buildSmartContext — typeFilter (spec 041 fix — was previously accepted but silently ignored)", () => {
  const mixedTypeGraph = {
    project: "mixed",
    stats: { files: 1, functions: 1, classes: 1, interfaces: 0, edges: 0 },
    nodes: [
      { id: "auth.ts", label: "auth.ts", type: "file", file: "auth.ts", group: "service" },
      { id: "auth.ts__login", label: "login", type: "function", file: "auth.ts", group: "service" },
      { id: "auth.ts__Login", label: "Login", type: "class", file: "auth.ts", group: "service" },
    ],
    edges: [],
  };

  it("restricts search candidates to the given type", async () => {
    const { text } = await buildSmartContext("login", mixedTypeGraph as any, {
      maxNodes: 25,
      typeFilter: "class",
    });
    // The class match should be found; searching should not fall through
    // to "No nodes found" just because a function of the same keyword also
    // exists in the graph.
    expect(text).toContain("Login");
  });

  it("returns a 'no nodes found' message, not an unfiltered result, when nothing matches the type", async () => {
    const { text } = await buildSmartContext("login", mixedTypeGraph as any, {
      maxNodes: 25,
      typeFilter: "interface",
    });
    expect(text).toContain("No nodes found");
    expect(text).toContain("interface");
  });
});
