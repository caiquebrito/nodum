# Nodum MCP Integration

Make nodum available as a Claude AI tool via Model Context Protocol.

## What is MCP?

MCP enables Claude to:
- Call nodum functions directly (sync, search, analyze)
- Access your project's knowledge graph in real-time
- Answer code questions with full project context
- Help with architecture decisions using dependency analysis

## Architecture

```
Claude (claude.ai or agent)
    ↓
MCP Client (your IDE/app)
    ↓
Nodum MCP Server (Node.js process)
    ↓
Your project files + ~/.nodum/ data
```

## Implementation Plan

### Phase 1: Create MCP Server (1-2 hours)

Create `packages/mcp/`:

```typescript
// packages/mcp/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({
  name: "nodum",
  version: "1.0.0",
});

// Define available tools
const tools: Tool[] = [
  {
    name: "sync_project",
    description: "Scan a project and build its knowledge graph",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the project"
        }
      },
      required: ["project_path"]
    }
  },
  {
    name: "get_graph",
    description: "Get the knowledge graph for a synced project",
    inputSchema: {
      type: "object",
      properties: {
        project_name: {
          type: "string",
          description: "Project name (folder name)"
        }
      },
      required: ["project_name"]
    }
  },
  {
    name: "search_graph",
    description: "Search the knowledge graph by name or type",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        query: { type: "string", description: "Function, class, or file name" },
        type_filter: { 
          type: "string", 
          enum: ["function", "class", "file", "interface"],
          description: "Optional: filter by node type"
        }
      },
      required: ["project_name", "query"]
    }
  },
  {
    name: "get_dependencies",
    description: "Find what a code element depends on",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        node_id: { type: "string", description: "Function/class ID from graph" }
      },
      required: ["project_name", "node_id"]
    }
  },
  {
    name: "analyze_file",
    description: "Get all functions, classes, and dependencies in a file",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        file_path: { type: "string" }
      },
      required: ["project_name", "file_path"]
    }
  },
  {
    name: "project_status",
    description: "List all synced projects and their stats",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// Register tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request;

  switch (name) {
    case "sync_project":
      return await handleSync(args.project_path);
    case "get_graph":
      return await handleGetGraph(args.project_name);
    case "search_graph":
      return await handleSearch(args.project_name, args.query, args.type_filter);
    case "get_dependencies":
      return await handleGetDeps(args.project_name, args.node_id);
    case "analyze_file":
      return await handleAnalyzeFile(args.project_name, args.file_path);
    case "project_status":
      return await handleStatus();
    default:
      return { error: `Unknown tool: ${name}` };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Phase 2: Tool Implementations

```typescript
// packages/mcp/src/handlers.ts

import { syncProject } from "@caiquebrito/nodum-core";
import { loadProjectIndex, loadGraph } from "../utils/fs.js";

export async function handleSync(projectPath: string) {
  try {
    const result = await syncProject(projectPath, expandHome("~/.nodum"));
    return {
      content: [{
        type: "text",
        text: `✅ Synced: ${result.project}
📁 Files: ${result.stats.files}
⚙️  Functions: ${result.stats.functions}
📦 Classes: ${result.stats.classes}
🔗 Dependencies: ${result.stats.edges}`
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function handleGetGraph(projectName: string) {
  try {
    const graph = await loadGraph(projectName);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          project: graph.project,
          stats: graph.stats,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          sample: graph.nodes.slice(0, 5)
        }, null, 2)
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function handleSearch(
  projectName: string,
  query: string,
  typeFilter?: string
) {
  try {
    const graph = await loadGraph(projectName);
    let results = graph.nodes.filter(n =>
      n.label.toLowerCase().includes(query.toLowerCase()) ||
      n.id.includes(query)
    );

    if (typeFilter) {
      results = results.filter(n => n.type === typeFilter);
    }

    return {
      content: [{
        type: "text",
        text: results.length === 0
          ? `No results for "${query}"`
          : JSON.stringify(results.slice(0, 20), null, 2)
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function handleGetDeps(
  projectName: string,
  nodeId: string
) {
  try {
    const graph = await loadGraph(projectName);
    const deps = graph.edges.filter(e => e.source === nodeId);
    const dependents = graph.edges.filter(e => e.target === nodeId);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          node: nodeId,
          dependencies: deps.map(d => ({
            target: d.target,
            relation: d.relation
          })),
          dependents: dependents.map(d => ({
            source: d.source,
            relation: d.relation
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function handleAnalyzeFile(
  projectName: string,
  filePath: string
) {
  try {
    const graph = await loadGraph(projectName);
    const fileNode = graph.nodes.find(n =>
      n.file === filePath && n.type === "file"
    );

    if (!fileNode) {
      return { error: `File not found: ${filePath}` };
    }

    // Get all nodes in this file
    const nodesInFile = graph.nodes.filter(n => n.file === filePath);

    // Get edges for these nodes
    const edgesInFile = graph.edges.filter(e =>
      nodesInFile.some(n => n.id === e.source || n.id === e.target)
    );

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          file: filePath,
          nodes: nodesInFile,
          externalDeps: edgesInFile.filter(e =>
            !nodesInFile.some(n => n.id === e.target)
          )
        }, null, 2)
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function handleStatus() {
  try {
    const projects = await loadProjectIndex();
    return {
      content: [{
        type: "text",
        text: `Synced Projects:\n\n${
          Object.entries(projects).map(([name, data]: any) =>
            `📦 ${name}
   Files: ${data.stats.files}
   Functions: ${data.stats.functions}
   Last synced: ${new Date(data.lastSync).toLocaleString()}`
          ).join('\n\n')
        }`
      }]
    };
  } catch (error) {
    return { error: error.message };
  }
}
```

### Phase 3: Configuration

Create `packages/mcp/package.json`:

```json
{
  "name": "@caiquebrito/nodum-mcp",
  "version": "1.0.0",
  "description": "Nodum MCP server for Claude integration",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "nodum-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@caiquebrito/nodum-core": "file:../core",
    "@modelcontextprotocol/sdk": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

## Integration with Claude (claude.ai/code)

### Step 1: Install Nodum MCP
```bash
npm install -g @caiquebrito/nodum-mcp
```

### Step 2: Configure in Claude Code Settings

In Claude Code → Settings → MCP Servers:

```json
{
  "name": "nodum",
  "command": "node",
  "args": ["/path/to/node_modules/@caiquebrito/nodum-mcp/dist/index.js"]
}
```

Or simpler:
```json
{
  "name": "nodum",
  "command": "nodum-mcp"
}
```

### Step 3: Use in Claude

Now you can ask Claude (in your code editor with MCP enabled):

```
Q: What does the `authenticateUser` function do and what does it depend on?
→ Claude calls `search_graph` → finds the function → calls `get_dependencies` → explains

Q: Analyze the auth flow in this project
→ Claude calls `search_graph` for auth-related files → calls `analyze_file` on each → builds complete picture

Q: What's the impact of changing this service?
→ Claude calls `get_dependencies` to trace dependents → shows all affected files
```

## Phase 4: Enhancements (Future)

- Real-time graph updates
- Live file watcher integration
- Architecture violation detection
- Refactoring suggestions based on dependency analysis
- Integration with Claude's native code editor tools

## Testing the MCP Server

```bash
# 1. Build the MCP package
cd packages/mcp
npm run build

# 2. Test locally
node dist/index.js

# 3. Send a test message (in another terminal):
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "test"}}}' | \
  node dist/index.js
```

## Publishing MCP

```bash
npm publish --access public
```

This creates `@caiquebrito/nodum-mcp` on npm, allowing anyone to:
```bash
npm install -g @caiquebrito/nodum-mcp
# Configure in their Claude Code settings
# Use nodum tools directly in Claude!
```

## The End Result

Users can:
1. Install nodum CLI globally
2. Add nodum MCP to Claude Code settings
3. Have Claude understand their entire codebase in real-time
4. Get smarter code reviews, refactoring suggestions, and architecture advice

All powered by the knowledge graph!
