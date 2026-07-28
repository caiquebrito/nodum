#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
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
} from "./handlers.js";

const server = new Server(
  {
    name: "nodum",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: "sync_project",
    description:
      "Scan a project and build its knowledge graph. Creates graph data at ~/.nodum/",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the project to scan",
        },
      },
      required: ["project_path"],
    },
  },
  {
    name: "project_status",
    description: "List all synced projects and their statistics",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_graph",
    description:
      "Get the complete knowledge graph for a synced project (nodes and edges)",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description:
            "Project name (folder name from sync, e.g., 'my-app', 'nodum')",
        },
      },
      required: ["project_name"],
    },
  },
  {
    name: "get_node",
    description: "Get details about a specific node (function, class, or file)",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        node_id: {
          type: "string",
          description: "Node ID from the graph",
        },
      },
      required: ["project_name", "node_id"],
    },
  },
  {
    name: "search_graph",
    description: "Search for functions, classes, or files by name or pattern",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        query: {
          type: "string",
          description: "Search query (function name, class name, file path)",
        },
        type_filter: {
          type: "string",
          enum: ["function", "class", "file", "interface", "method"],
          description: "Optional: filter results by node type",
        },
      },
      required: ["project_name", "query"],
    },
  },
  {
    name: "get_dependencies",
    description:
      "Find all dependencies (outgoing edges) from a node. Shows what a function/class depends on.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        node_id: {
          type: "string",
          description: "Node ID to analyze",
        },
      },
      required: ["project_name", "node_id"],
    },
  },
  {
    name: "get_dependents",
    description:
      "Find all dependents (incoming edges) to a node. Shows what depends on a function/class.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        node_id: {
          type: "string",
          description: "Node ID to analyze",
        },
      },
      required: ["project_name", "node_id"],
    },
  },
  {
    name: "analyze_file",
    description:
      "Get all functions, classes, and dependencies within a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        file_path: {
          type: "string",
          description: "Path to file (e.g., 'src/auth/login.ts')",
        },
      },
      required: ["project_name", "file_path"],
    },
  },
  {
    name: "expand_cluster",
    description:
      "Expand a cluster to see all member nodes and their relationships (v2.0 feature)",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        cluster_id: {
          type: "string",
          description: "Cluster ID (e.g., 'cluster_0', 'cluster_1')",
        },
      },
      required: ["project_name", "cluster_id"],
    },
  },
  {
    name: "trace_impact",
    description:
      "Show every file transitively affected by changing a given file/function/class — the cascade of changes if you modify X.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        node_id: {
          type: "string",
          description: "Node ID to trace impact from",
        },
        max_depth: {
          type: "number",
          description: "Optional: cap how many hops to report",
        },
      },
      required: ["project_name", "node_id"],
    },
  },
  {
    name: "find_bottlenecks",
    description:
      "Rank files by a composite bottleneck score — code complexity combined with how many other files transitively depend on them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        limit: {
          type: "number",
          description: "Optional: cap the number of results",
        },
      },
      required: ["project_name"],
    },
  },
  {
    name: "explain_architecture",
    description:
      "Auto-generate an architecture overview: layers present, how they depend on each other, and any violations of the project's declared architecture rules.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
      },
      required: ["project_name"],
    },
  },
  {
    name: "find_similar_code",
    description:
      "Find other functions/methods structurally near-identical to a given node (same control-flow shape, robust to renaming).",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        node_id: {
          type: "string",
          description: "Node ID to find similar code for",
        },
      },
      required: ["project_name", "node_id"],
    },
  },
  {
    name: "suggest_refactoring",
    description:
      "Unified refactoring suggestions synthesized from every analysis capability: circular imports, dead files, architecture-rule violations, overly complex functions, and duplicated code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name",
        },
        complexity_threshold: {
          type: "number",
          description: "Optional: override the default complexity threshold (10)",
        },
      },
      required: ["project_name"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: { content: TextContent[] } | { error: string };

    switch (name) {
      case "sync_project":
        result = await handleSync((args as any).project_path as string);
        break;
      case "project_status":
        result = await handleStatus();
        break;
      case "get_graph":
        result = await handleGetGraph((args as any).project_name as string);
        break;
      case "get_node":
        result = await handleGetNode(
          (args as any).project_name as string,
          (args as any).node_id as string
        );
        break;
      case "search_graph":
        result = await handleSearch(
          (args as any).project_name as string,
          (args as any).query as string,
          (args as any).type_filter as string | undefined
        );
        break;
      case "get_dependencies":
        result = await handleGetDeps(
          (args as any).project_name as string,
          (args as any).node_id as string,
          "outgoing"
        );
        break;
      case "get_dependents":
        result = await handleGetDeps(
          (args as any).project_name as string,
          (args as any).node_id as string,
          "incoming"
        );
        break;
      case "analyze_file":
        result = await handleAnalyzeFile(
          (args as any).project_name as string,
          (args as any).file_path as string
        );
        break;
      case "expand_cluster":
        result = await handleExpandCluster(
          (args as any).project_name as string,
          (args as any).cluster_id as string
        );
        break;
      case "trace_impact":
        result = await handleTraceImpact(
          (args as any).project_name as string,
          (args as any).node_id as string,
          (args as any).max_depth as number | undefined
        );
        break;
      case "find_bottlenecks":
        result = await handleFindBottlenecks(
          (args as any).project_name as string,
          (args as any).limit as number | undefined
        );
        break;
      case "explain_architecture":
        result = await handleExplainArchitecture(
          (args as any).project_name as string
        );
        break;
      case "find_similar_code":
        result = await handleFindSimilarCode(
          (args as any).project_name as string,
          (args as any).node_id as string
        );
        break;
      case "suggest_refactoring":
        result = await handleSuggestRefactoring(
          (args as any).project_name as string,
          (args as any).complexity_threshold as number | undefined
        );
        break;
      default:
        return { error: `Unknown tool: ${name}` };
    }

    return result;
  } catch (error) {
    return { error: String(error) };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
