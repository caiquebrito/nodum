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
