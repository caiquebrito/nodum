# 🚀 Nodum Complete Setup Guide

Your project is now ready for both npm publishing and Claude MCP integration!

## Status Check ✅

- ✅ Monorepo structure (core, cli, server, mcp)
- ✅ CLI working (`nodum sync`, `nodum serve`, `nodum status`)
- ✅ Server running (3D viewer on localhost:7842)
- ✅ MCP server built and ready
- ✅ Benchmark suite implemented
- ✅ Knowledge graph generation working

---

## Phase 1: Publish to npm

### Step 1: Login to npm

```bash
npm adduser
# or if you're already logged in:
npm login
```

Enter your npm credentials:
- Username: your npm username
- Password: your npm password
- Email: your email
- OTP: (if 2FA enabled) your one-time password

### Step 2: Publish Main Package

```bash
npm publish --access public
```

This publishes `@caiquebrito/nodum` with:
- CLI: `npx nodum sync /path/to/project`
- Server: `npx nodum serve`
- Core library: Can be imported as `import { syncProject } from '@caiquebrito/nodum-core'`

### Step 3: Publish MCP Package

```bash
npm publish --access public --workspace packages/mcp
```

This publishes `@caiquebrito/nodum-mcp` (the Claude integration).

### Verification

Check npm:
```bash
npm view @caiquebrito/nodum
npm view @caiquebrito/nodum-mcp
```

Visit:
- https://www.npmjs.com/package/@caiquebrito/nodum
- https://www.npmjs.com/package/@caiquebrito/nodum-mcp

---

## Phase 2: Set Up Claude MCP Integration

Once published, users (and you) can integrate with Claude in multiple ways:

### Option A: Claude Code IDE (Recommended)

1. **Install globally:**
   ```bash
   npm install -g @caiquebrito/nodum
   npm install -g @caiquebrito/nodum-mcp
   ```

2. **Configure Claude Code settings** (in your IDE):
   
   Open Claude Code → Settings → MCP Servers and add:
   ```json
   {
     "name": "nodum",
     "command": "nodum-mcp"
   }
   ```
   
   Or with full path:
   ```json
   {
     "name": "nodum",
     "command": "node",
     "args": ["/usr/local/lib/node_modules/@caiquebrito/nodum-mcp/dist/index.js"]
   }
   ```

3. **Restart Claude Code**

4. **Start using in Claude:**
   ```
   Claude: Analyze the authentication flow in my project
   → Claude uses sync_project + search_graph + analyze_file tools
   → Returns complete analysis with context from your code graph
   ```

### Option B: claude.ai/code Web Editor

Same as Option A - add to MCP servers in settings, then use Claude for code questions.

### Option C: Custom Claude Agents

Use the MCP in your own agents:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  mcpServers: {
    nodum: {
      command: "nodum-mcp"
    }
  }
});

// Claude can now call nodum tools
const response = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 2048,
  tools: [], // Tools loaded from MCP server
  messages: [{
    role: "user",
    content: "What are all the API endpoints in my project?"
  }]
});
```

---

## Available MCP Tools

Once integrated, Claude can use these tools:

### 1. `sync_project`
Scan a project and build its knowledge graph.

```
Claude: Sync my project at /path/to/my/app
→ Returns: Files, functions, classes, dependencies stats
```

### 2. `project_status`
List all synced projects and their statistics.

```
Claude: What projects have I synced?
→ Returns: All projects with stats and last sync time
```

### 3. `get_graph`
Get the complete knowledge graph for a project.

```
Claude: Get the knowledge graph for my nodum project
→ Returns: All nodes (files, functions, classes) and edges
```

### 4. `search_graph`
Search for functions, classes, or files by name.

```
Claude: Find all functions related to authentication
→ Returns: List of matching nodes
```

### 5. `get_node`
Get details about a specific code element.

```
Claude: Tell me about the loginUser function and what it depends on
→ Returns: Function details + dependencies + dependents
```

### 6. `get_dependencies`
Find what a code element depends on.

```
Claude: What does the UserService class depend on?
→ Returns: All outgoing edges (dependencies)
```

### 7. `get_dependents`
Find what depends on a code element.

```
Claude: What uses the authenticate function?
→ Returns: All incoming edges (code that depends on it)
```

### 8. `analyze_file`
Get all functions and dependencies in a file.

```
Claude: Analyze the src/auth/login.ts file
→ Returns: All functions/classes + external dependencies
```

---

## Example Workflows

### Workflow 1: Code Review with Context

```
You: @Claude review this PR - what's the impact?
Claude:
1. Calls sync_project to get your project graph
2. Searches for modified files in the PR
3. Calls get_dependents to see what breaks
4. Provides impact analysis with confidence
```

### Workflow 2: Refactoring Suggestions

```
You: I want to refactor UserService - is it safe?
Claude:
1. Searches for UserService in the graph
2. Calls get_dependents to find all code using it
3. Calls analyze_file on each dependent
4. Provides refactoring plan with minimal risk
```

### Workflow 3: Architecture Questions

```
You: What's the auth flow from login page to API?
Claude:
1. Searches for login-related functions
2. Traces dependencies through the graph
3. Builds complete flow diagram
4. Explains with actual code structure context
```

---

## Testing the MCP Server Locally

```bash
# Build everything
npm run build

# Test the MCP server by itself
node packages/mcp/dist/index.js

# In another terminal, test a tool call:
# (This requires MCP protocol formatting, so use via IDE instead)
```

---

## Publishing Updates

When you make changes:

```bash
# Bump version
npm version minor  # or patch/major

# Build
npm run build

# Publish (both packages)
npm publish --access public --workspace .

# Push to GitHub
git push origin main
git push origin --tags
```

---

## Next Steps

1. **✅ Done**: MCP server built and tested
2. **🔄 Next**: npm publish (need npm account + login)
3. **➡️ Then**: Configure in Claude Code settings
4. **🎯 Final**: Use Claude with full project context!

---

## Troubleshooting

### MCP not appearing in Claude Code settings
- Restart Claude Code completely
- Verify `nodum-mcp` is in PATH: `which nodum-mcp`
- Check npm install: `npm list -g @caiquebrito/nodum-mcp`

### MCP tools not working
- Check ~/.nodum/ exists and has data
- Run `nodum status` in terminal to verify projects synced
- Check MCP server logs in Claude Code console

### Graph not updating
- Graphs are cached in ~/.nodum/
- Rerun `nodum sync /path` to refresh
- Clear cache: `rm -rf ~/.nodum/projectname`

---

## What Users Get

Once published, developers can:

```bash
# Install
npm install -g @caiquebrito/nodum

# Use CLI
nodum sync ~/myproject
nodum serve                    # View 3D graph
nodum status                   # Check projects

# Use with Claude
# → Add to MCP servers in Claude Code
# → Ask Claude code questions with full project context
```

Perfect for:
- 🤖 AI-assisted code reviews
- 🔍 Architecture analysis
- 🐛 Impact analysis before refactoring
- 📚 Understanding codebases
- 🚀 Onboarding new team members

---

## Questions?

Check the documentation:
- [PUBLISH.md](./PUBLISH.md) - npm publishing details
- [MCP.md](./MCP.md) - MCP implementation details
- [RUN.md](./RUN.md) - Running locally
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide

Good luck shipping! 🚀
