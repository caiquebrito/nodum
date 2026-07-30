# Nodum MCP Integration

How nodum's knowledge graph is exposed to Claude via Model Context Protocol (MCP).

## What MCP Gives You

MCP lets Claude:
- Call nodum's graph tools directly (sync, search, analyze, trace impact)
- Access a project's knowledge graph in real time
- Answer code questions with full project context
- Reason about architecture using real dependency data, not guesses

## Architecture

```
Claude (Claude Code, or any MCP-speaking client)
    ↓
MCP Client (your IDE/app)
    ↓  stdio transport
Nodum MCP Server (packages/mcp — Node.js process)
    ↓
~/.nodum/<project>/ graph data
```

The server (`packages/mcp/src/index.ts`) is built on the SDK's `McpServer`/`registerTool` API
(migrated off the deprecated low-level `Server`/`setRequestHandler` dispatch in v2.13.0). Every
tool declares its `inputSchema` as a [zod](https://zod.dev/) schema, which the SDK validates at
the protocol layer before a handler ever runs — no manual argument parsing or `as any` casts.
Each tool call is wrapped by `withMetrics()`, which times the call and appends a line to
`~/.nodum/<project>/logs/metrics.jsonl` (timestamp, tool name, duration, approximate response
tokens, success). Handler logic itself lives in `packages/mcp/src/handlers.ts`, kept separate
from tool registration.

## Available Tools

14 tools, registered via `server.registerTool(...)` in `packages/mcp/src/index.ts`:

| Tool | Does |
|---|---|
| `sync_project` | Scan a project and build its knowledge graph at `~/.nodum/` |
| `project_status` | List all synced projects and their statistics |
| `get_graph` | Get the complete knowledge graph (nodes + edges) for a project |
| `get_node` | Get details about a specific node (function, class, or file) |
| `search_graph` | Search for functions/classes/files by name or pattern, with an optional `token_budget` that fills context greedily by relevance |
| `get_dependencies` | Outgoing edges from a node — what it depends on |
| `get_dependents` | Incoming edges to a node — what depends on it |
| `analyze_file` | All functions, classes, and dependencies within one file |
| `expand_cluster` | Expand a hierarchical code cluster into its member nodes |
| `trace_impact` | Cascade of changes if you modify a given node |
| `find_bottlenecks` | Complexity × dependents composite ranking |
| `explain_architecture` | Layer/dependency overview plus rule violations |
| `find_similar_code` | Structurally near-identical code to a node (MinHash-based fuzzy match) |
| `suggest_refactoring` | Unified suggestions drawn from the analyzers above |

Every read-path handler is served through `GraphCache`, an in-process, TTL-based, per-project
cache so repeated tool calls against the same synced project don't re-parse `graph.json` from
disk each time; `sync_project` invalidates the relevant project's cache entry after writing a
fresh graph.

Responses follow the MCP SDK's `CallToolResult` shape (`content` + an `isError` flag) rather than
a bare `{ error: string }` — every handler returns a protocol-valid error response.

## Integrating with Claude Code

### 1. Install

```bash
npm install -g @caiquebrito/nodum-mcp
```

### 2. Register the server

Recommended — handles `PATH` for you:

```bash
claude mcp add nodum -- nodum-mcp
```

Or create a `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "nodum": {
      "command": "nodum-mcp"
    }
  }
}
```

If Claude Code can't find `nodum-mcp` on its `PATH` (it spawns servers without your shell's full
`PATH`), point at absolute paths instead:

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

### 3. Use it

```
Q: What does authenticateUser do and what does it depend on?
→ Claude calls search_graph → finds the function → calls get_dependencies → explains

Q: What's the impact of changing this service?
→ Claude calls trace_impact / get_dependents → shows the real cascade of affected files
```

Any other MCP-speaking client (Cursor, Zed, Continue, ...) works the same way — the server is
client-agnostic; nothing here is Claude-specific beyond the name.

## Testing the Server Locally

```bash
cd packages/mcp
npm run build
node dist/index.js
```

The server speaks MCP over stdio — exercise it through a real MCP client rather than by hand.

## Related

- [`docs/guides/SETUP-GUIDE.md`](../guides/SETUP-GUIDE.md) — end-to-end setup walkthrough
- [`docs/architecture/SMART-CONTEXT.md`](./SMART-CONTEXT.md) — how `search_graph`/`get_graph`
  build token-efficient context
- [`docs/development/ROADMAP.md`](../development/ROADMAP.md) — v2.13.0 (`registerTool` migration)
  and v2.11.0 (`isError` protocol fix) entries for the history behind this design
