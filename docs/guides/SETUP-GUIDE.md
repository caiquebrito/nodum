# Nodum Setup Guide — Claude Integration

Complete walkthrough for connecting nodum's knowledge graph to Claude via MCP (Model Context
Protocol). For installing/running the CLI on its own, see [Quick Start](./QUICKSTART.md) and
[Running Nodum](./RUN.md). For publishing a release, see
[`docs/development/PUBLISH.md`](../development/PUBLISH.md).

## 1. Install

```bash
npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
```

## 2. Sync a Project

```bash
cd ~/my-project
nodum sync
```

## 3. Connect Claude Code

Claude Code reads MCP servers from a `.mcp.json` file in your project root, or its own user
config — **not** from `settings.json` (its `mcpServers` field is silently ignored).

### Option A: `claude mcp add` (recommended)

```bash
claude mcp add nodum -- nodum-mcp
```

Restart Claude Code, then run `/mcp` to confirm `nodum` is connected.

### Option B: `.mcp.json` in your project root

```json
{
  "mcpServers": {
    "nodum": {
      "command": "nodum-mcp"
    }
  }
}
```

Claude Code will prompt you to trust the server the next time it opens that directory.

### Troubleshooting: "command not found" / server won't connect

Claude Code spawns the MCP server without your shell's full `PATH`, so it may not find the global
npm bin. Point the config at absolute paths instead:

```bash
which node        # e.g. /opt/homebrew/bin/node
which nodum-mcp   # e.g. /opt/homebrew/bin/nodum-mcp
```

```json
{
  "mcpServers": {
    "nodum": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/bin/nodum-mcp"]
    }
  }
}
```

### Other MCP clients

Any MCP-speaking client can use the same server — point it at the `nodum-mcp` command the same
way you would for Claude Code. No per-client code is needed.

---

## Available MCP Tools

The MCP server exposes 14 tools (`packages/mcp/src/index.ts`):

| Tool | Does |
|---|---|
| `sync_project` | Scan a project and build/refresh its knowledge graph |
| `project_status` | List all synced projects and their stats |
| `get_graph` | Fetch the complete knowledge graph for a project |
| `get_node` | Get details about a specific code element |
| `search_graph` | Search for functions, classes, or files by name, with an optional token budget |
| `get_dependencies` | What a code element depends on |
| `get_dependents` | What depends on a code element |
| `analyze_file` | All functions/classes and dependencies in one file |
| `expand_cluster` | Expand a hierarchical code cluster into its members |
| `trace_impact` | Cascade of changes if you modify a given node |
| `find_bottlenecks` | Complexity × dependents composite ranking |
| `explain_architecture` | Layer/dependency overview and rule violations |
| `find_similar_code` | Structurally near-identical code to a node (fuzzy) |
| `suggest_refactoring` | Unified suggestions drawn from the above analyzers |

See [`docs/architecture/MCP.md`](../architecture/MCP.md) for how the server is built.

---

## Example Workflows

### Code Review with Context
```
You: @Claude review this PR — what's the impact?
Claude:
1. Calls search_graph to find the modified files/functions
2. Calls trace_impact / get_dependents to see what breaks
3. Provides impact analysis grounded in the real dependency graph
```

### Refactoring Safely
```
You: I want to refactor UserService — is it safe?
Claude:
1. Searches for UserService in the graph
2. Calls get_dependents and find_bottlenecks
3. Calls suggest_refactoring for a concrete plan
```

### Architecture Questions
```
You: What's the auth flow from login page to API?
Claude:
1. Searches for login-related functions
2. Calls explain_architecture / traces dependencies through the graph
3. Explains with your actual code structure, not a guess
```

---

## Testing the MCP Server Locally

```bash
npm run build
node packages/mcp/dist/index.js
```

The server speaks MCP over stdio — test tool calls through an actual MCP client (Claude Code,
etc.) rather than by hand.

---

## Troubleshooting

### MCP not appearing in Claude Code
- Restart Claude Code completely.
- Verify `nodum-mcp` is on `PATH`: `which nodum-mcp`.
- Check the install: `npm list -g @caiquebrito/nodum-mcp`.

### MCP tools not returning data
- Confirm `~/.nodum/` has data for the project: `nodum status`.
- Re-sync to refresh: `nodum sync /path/to/project`.
- Clear a project's cache: `rm -rf ~/.nodum/<project-name>`.

---

## Next

- [Running Nodum](./RUN.md) — full CLI command reference
- [MCP Integration](../architecture/MCP.md) — server architecture
- [Smart Context](../architecture/SMART-CONTEXT.md) — how token-efficient context is built
