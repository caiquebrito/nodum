#!/usr/bin/env node
import { ensureLiftoffOnly } from "@caiquebrito/nodum-core";
ensureLiftoffOnly();

import { readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TextContent, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { checkLatestVersion, formatUpdateNotice, appendMetricsLog, countTokens } from "@caiquebrito/nodum-core";
import {
  handleSync,
  handleGetGraph,
  handleSearch,
  handleGetDeps,
  handleAnalyzeFile,
  handleStatus,
  handleGetNode,
  handleExpandCluster,
  handleTraceImpact,
  handleFindBottlenecks,
  handleExplainArchitecture,
  handleFindSimilarCode,
  handleSuggestRefactoring,
  NODUM_DATA_DIR,
} from "@caiquebrito/nodum-query";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_NAME = "@caiquebrito/nodum-mcp";
const OWN_VERSION = (
  JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as { version: string }
).version;

const server = new McpServer(
  {
    name: "nodum",
    version: OWN_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

type ToolResult = CallToolResult;

/**
 * Wraps a tool handler with the same per-call metrics logging every tool
 * needs — timing, `isError`-based success tracking (spec 050), and
 * project-scoped log paths — written once and applied at every
 * `registerTool` call site below, replacing the old manual dispatch
 * switch's inline block (spec 057).
 *
 * Deliberate, disclosed gap (spec 057): the SDK validates `inputSchema` and
 * resolves the tool name *before* this callback ever runs, so an invalid-args
 * or unknown-tool call never reaches this wrapper — those two paths no
 * longer get a metrics log entry. Both remain protocol-valid `isError`
 * responses (the SDK's own behavior, not this codebase's), just unlogged;
 * judged acceptable since they're low-frequency error paths, not a
 * correctness concern.
 */
// `buildSmartContext`'s formatted response text (smart-context.ts) always
// appends one of these exact phrases when the corresponding condition
// holds — see its `notes` array. Deriving `cacheHit`/`truncated` (spec 065)
// by matching them here is a text-scrape, not a structured return value,
// but it avoids threading new fields through every handler/tool-result path
// just to log them; if `buildSmartContext`'s wording ever changes, these
// two fields silently stop populating (best-effort, same posture as
// `appendMetricsLog` itself) rather than breaking anything.
const CACHE_HIT_MARKER = "served from cache";
const TRUNCATED_MARKER = "truncated to fit token budget";
const RESULT_NODE_COUNT_PATTERN = /Context includes: (\d+) relevant nodes/;

/**
 * `search_graph`'s default `token_budget` when the caller doesn't specify
 * one (spec 070) — before this, the common, unbudgeted call path never
 * exercised `fillSectionsToBudget` (`smart-context.ts`) at all. Chosen as a
 * generous-but-real budget: comfortably larger than a typical unbudgeted
 * response for a normal (non-hub) query per `benchmarks/context-size.test.ts`'s
 * `NORMAL_QUERY_CEILING`, while still small enough to actually engage the
 * budgeting machinery on a large expanded set. See this spec's Success
 * Metrics for the measured before/after this produced.
 */
const DEFAULT_SEARCH_TOKEN_BUDGET = 1500;

/**
 * Resolves `search_graph`'s `token_budget` argument (spec 070):
 * - `undefined` (caller didn't specify) -> the default budget.
 * - explicit `0` or `null` (caller wants everything) -> `undefined`, i.e.
 *   `buildSmartContext`'s own "unbounded" contract.
 * - any other number -> passed through unchanged.
 */
function resolveTokenBudget(raw: number | null | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_SEARCH_TOKEN_BUDGET;
  if (raw === 0 || raw === null) return undefined;
  return raw;
}

/**
 * Wraps a tool handler with the same per-call metrics logging every tool
 * needs — timing, `isError`-based success tracking (spec 050), and
 * project-scoped log paths — written once and applied at every
 * `registerTool` call site below, replacing the old manual dispatch
 * switch's inline block (spec 057).
 *
 * Deliberate, disclosed gap (spec 057): the SDK validates `inputSchema` and
 * resolves the tool name *before* this callback ever runs, so an invalid-args
 * or unknown-tool call never reaches this wrapper — those two paths no
 * longer get a metrics log entry. Both remain protocol-valid `isError`
 * responses (the SDK's own behavior, not this codebase's), just unlogged;
 * judged acceptable since they're low-frequency error paths, not a
 * correctness concern.
 */
function withMetrics<Args extends Record<string, unknown>>(
  toolName: string,
  handler: (args: Args) => Promise<ToolResult>
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    const startedAt = Date.now();
    const projectName = typeof args?.project_name === "string" ? (args.project_name as string) : undefined;
    const query = typeof args?.query === "string" ? (args.query as string) : undefined;
    // `search_graph`'s `token_budget` now defaults rather than being purely
    // opt-in (spec 070) — `budgetApplied` reflects whether budgeting will
    // actually run (the resolved value, including the default), not just
    // whether the caller happened to pass the argument. Gated on
    // `toolName === "search_graph"` since that's the only tool with a
    // `token_budget` field at all; `resolveTokenBudget` would otherwise
    // wrongly default a `token_budget: undefined` read off some other
    // tool's args (which simply lacks the field, not "caller omitted it").
    const budgetApplied =
      toolName === "search_graph" &&
      resolveTokenBudget(args?.token_budget as number | null | undefined) !== undefined;

    let result: ToolResult;
    try {
      result = await handler(args);
    } catch (error) {
      result = { content: [{ type: "text", text: String(error) }], isError: true };
    }

    const success = !result.isError;
    const responseText = result.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    const resultNodeCountMatch = responseText.match(RESULT_NODE_COUNT_PATTERN);

    await appendMetricsLog(join(NODUM_DATA_DIR, projectName ?? "_unscoped", "logs"), {
      timestamp: new Date().toISOString(),
      tool: toolName,
      projectName,
      durationMs: Date.now() - startedAt,
      approxTokens: responseText ? countTokens(responseText) : undefined,
      success,
      ...(query !== undefined ? { query } : {}),
      ...(budgetApplied ? { budgetApplied } : {}),
      ...(resultNodeCountMatch ? { resultNodeCount: Number(resultNodeCountMatch[1]) } : {}),
      ...(responseText.includes(CACHE_HIT_MARKER) ? { cacheHit: true } : {}),
      ...(responseText.includes(TRUNCATED_MARKER) ? { truncated: true } : {}),
    });

    return result;
  };
}

server.registerTool(
  "sync_project",
  {
    description: "Scan a project and build its knowledge graph. Creates graph data at ~/.nodum/",
    inputSchema: {
      project_path: z.string().describe("Absolute path to the project to scan"),
    },
  },
  withMetrics("sync_project", async (args) => handleSync(args.project_path))
);

server.registerTool(
  "project_status",
  {
    description: "List all synced projects and their statistics",
    inputSchema: {},
  },
  withMetrics("project_status", async () => handleStatus())
);

server.registerTool(
  "get_graph",
  {
    description: "Get the complete knowledge graph for a synced project (nodes and edges)",
    inputSchema: {
      project_name: z.string().describe("Project name (folder name from sync, e.g., 'my-app', 'nodum')"),
    },
  },
  withMetrics("get_graph", async (args) => handleGetGraph(args.project_name))
);

server.registerTool(
  "get_node",
  {
    description: "Get details about a specific node (function, class, or file)",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      node_id: z.string().describe("Node ID from the graph"),
    },
  },
  withMetrics("get_node", async (args) => handleGetNode(args.project_name, args.node_id))
);

server.registerTool(
  "search_graph",
  {
    description: "Search for functions, classes, or files by name or pattern",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      query: z.string().describe("Search query (function name, class name, file path)"),
      type_filter: z
        .enum(["function", "class", "file", "interface", "method", "struct", "enum", "protocol", "extension"])
        .optional()
        .describe("Optional: filter results by node type"),
      token_budget: z
        .number()
        .nullable()
        .optional()
        .describe(
          `Optional: approximate token budget for the returned context. Sections are included in relevance order until the next one would exceed the budget — the single highest-priority section is always included even if it alone exceeds it. Defaults to ${DEFAULT_SEARCH_TOKEN_BUDGET} when omitted (spec 070); pass 0 or null explicitly for the old unbounded-by-tokens behavior.`
        ),
    },
  },
  withMetrics("search_graph", async (args) =>
    handleSearch(args.project_name, args.query, args.type_filter, resolveTokenBudget(args.token_budget))
  )
);

server.registerTool(
  "get_dependencies",
  {
    description: "Find all dependencies (outgoing edges) from a node. Shows what a function/class depends on.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      node_id: z.string().describe("Node ID to analyze"),
    },
  },
  withMetrics("get_dependencies", async (args) => handleGetDeps(args.project_name, args.node_id, "outgoing"))
);

server.registerTool(
  "get_dependents",
  {
    description: "Find all dependents (incoming edges) to a node. Shows what depends on a function/class.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      node_id: z.string().describe("Node ID to analyze"),
    },
  },
  withMetrics("get_dependents", async (args) => handleGetDeps(args.project_name, args.node_id, "incoming"))
);

server.registerTool(
  "analyze_file",
  {
    description: "Get all functions, classes, and dependencies within a file",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      file_path: z.string().describe("Path to file (e.g., 'src/auth/login.ts')"),
    },
  },
  withMetrics("analyze_file", async (args) => handleAnalyzeFile(args.project_name, args.file_path))
);

server.registerTool(
  "expand_cluster",
  {
    description: "Expand a cluster to see all member nodes and their relationships (v2.0 feature)",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      cluster_id: z.string().describe("Cluster ID (e.g., 'cluster_0', 'cluster_1')"),
    },
  },
  withMetrics("expand_cluster", async (args) => handleExpandCluster(args.project_name, args.cluster_id))
);

server.registerTool(
  "trace_impact",
  {
    description:
      "Show every file transitively affected by changing a given file/function/class — the cascade of changes if you modify X.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      node_id: z.string().describe("Node ID to trace impact from"),
      max_depth: z.number().optional().describe("Optional: cap how many hops to report"),
    },
  },
  withMetrics("trace_impact", async (args) => handleTraceImpact(args.project_name, args.node_id, args.max_depth))
);

server.registerTool(
  "find_bottlenecks",
  {
    description:
      "Rank files by a composite bottleneck score — code complexity combined with how many other files transitively depend on them.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      limit: z.number().optional().describe("Optional: cap the number of results"),
    },
  },
  withMetrics("find_bottlenecks", async (args) => handleFindBottlenecks(args.project_name, args.limit))
);

server.registerTool(
  "explain_architecture",
  {
    description:
      "Auto-generate an architecture overview: layers present, how they depend on each other, and any violations of the project's declared architecture rules.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
    },
  },
  withMetrics("explain_architecture", async (args) => handleExplainArchitecture(args.project_name))
);

server.registerTool(
  "find_similar_code",
  {
    description:
      "Find other functions/methods structurally near-identical to a given node — exact structural duplicates (same normalized shape, robust to renaming) plus fuzzy near-duplicates (a MinHash-estimated structural similarity above a threshold, e.g. the same logic with a branch added or removed).",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      node_id: z.string().describe("Node ID to find similar code for"),
      threshold: z
        .number()
        .optional()
        .describe("Optional: minimum fuzzy-match similarity, 0-1 (default 0.8). Exact matches are always included regardless of this value."),
    },
  },
  withMetrics("find_similar_code", async (args) => handleFindSimilarCode(args.project_name, args.node_id, args.threshold))
);

server.registerTool(
  "suggest_refactoring",
  {
    description:
      "Unified refactoring suggestions synthesized from every analysis capability: circular imports, dead files, architecture-rule violations, overly complex functions, exact-duplicate code, and near-duplicate (fuzzy) code clustered transitively across the whole project.",
    inputSchema: {
      project_name: z.string().describe("Project name"),
      complexity_threshold: z.number().optional().describe("Optional: override the default complexity threshold (10)"),
    },
  },
  withMetrics("suggest_refactoring", async (args) => handleSuggestRefactoring(args.project_name, args.complexity_threshold))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  checkLatestVersion(PACKAGE_NAME, OWN_VERSION, join(homedir(), ".nodum", "update-check.json"))
    .then((result) => {
      if (result?.updateAvailable) console.error(formatUpdateNotice(result));
    })
    .catch(() => {
      // Best-effort startup notice — must never affect the server itself.
    });
}

main().catch(console.error);
