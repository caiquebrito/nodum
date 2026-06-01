# Nodum — Knowledge Graphs for Your Code

> A local knowledge graph that helps Claude AI understand your entire codebase. No cloud, no API keys, no subscriptions.

![npm](https://img.shields.io/npm/v/@caiquebrito/nodum-cli?style=flat-square&color=58a6ff)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178c6?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-16+-339933?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-bc8cff?style=flat-square)
![Open Source](https://img.shields.io/badge/open%20source-MIT-ff9f1a?style=flat-square)
![Made in Brazil](https://img.shields.io/badge/made%20in-Brazil%20🇧🇷-009c3b?style=flat-square)

---

## The Problem

Claude is smart, but it starts fresh each session. You describe your architecture, paste file paths, re-explain dependencies. Every conversation, you're explaining the same things.

The `CLAUDE.md` trick helps, but it's manual, gets outdated, and doesn't capture relationships.

**What if Claude understood your entire codebase automatically?**

---

## The Solution

**Nodum builds a knowledge graph of your code** and feeds it to Claude via MCP (Model Context Protocol).

One command:
```bash
nodum sync
```

Then Claude understands:
- All your files, functions, and classes
- Every dependency and relationship
- Your project structure
- Your technology stack

**Better answers. Fewer tokens. No hallucinations.**

---

## Quick Start

### 1. Install

```bash
npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
```

### 2. Sync Your Project

```bash
cd ~/my-project
nodum sync
```

Scans your project and creates a knowledge graph at `~/.nodum/my-project/`.

### 3. Configure Claude Code

Claude Code reads MCP servers from a `.mcp.json` file in your project root, or from its own user config — **not** from `settings.json` (the `mcpServers` field there is silently ignored). Pick one:

**Option A: `claude mcp add`** (recommended — handles PATH for you)

```bash
claude mcp add nodum -- nodum-mcp
```

Restart Claude Code, then run `/mcp` to confirm `nodum` is connected.

**Option B: `.mcp.json` in your project root**

Create a `.mcp.json` file at the root of the project you want indexed:

```json
{
  "mcpServers": {
    "nodum": {
      "command": "nodum-mcp"
    }
  }
}
```

When Claude Code opens in that directory it will prompt you to trust the server — accept it, then it appears in `/mcp`.

#### Troubleshooting: "command not found" / server won't connect

Claude Code spawns the MCP server **without your shell's full `PATH`**, so it may not find the global npm bin. Point the config at absolute paths instead. Find them with:

```bash
which node        # e.g. /opt/homebrew/bin/node
which nodum-mcp   # e.g. /opt/homebrew/bin/nodum-mcp
```

Then in `.mcp.json`, launch node directly with the script path:

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

### 4. Use Claude

```
Claude: "What's the auth flow in this project?"

Claude now understands your entire codebase structure 
and can give accurate, context-aware answers. ✨
```

---

## What Nodum Does

### 📊 Scans Your Code
- **TypeScript/JavaScript** (.ts, .tsx, .js)
- **Python** (.py)
- **Kotlin** (.kt)
- **Java** (.java)
- **More coming** (Go, Rust, C#)

Extracts: files, functions, classes, interfaces, imports, dependencies

### 🧠 Builds a Knowledge Graph
```
Files ──imports──> Files
  ├─ Functions ──calls──> Functions
  ├─ Classes ──extends──> Classes
  └─ Interfaces ──implements──> Interfaces
```

Stored at `~/.nodum/projectname/graph/graph.json`

### 🤖 Claude Integration via MCP
9 tools Claude can use:
- `sync_project` — Scan a project
- `get_graph` — Fetch the knowledge graph
- `search_graph` — Find functions/classes/files with semantic search (v2.0)
- `get_node` — Details about a code element
- `get_dependencies` — What does X depend on?
- `get_dependents` — What depends on X?
- `analyze_file` — Deep dive into a file
- `expand_cluster` — Explore grouped code regions (v2.0)
- `project_status` — List all synced projects

### 🎨 3D Visualization
View your code as an interactive 3D graph:

```bash
nodum serve
```

Opens `http://localhost:7842/` — orbit, zoom, click nodes, explore connections.

---

## Features

### CLI Commands

```bash
# Sync from current directory (or specify path)
nodum sync                    # Uses current directory
nodum sync /path/to/project   # Or explicit path

# View 3D graph
nodum serve

# Check synced projects
nodum status
```

### Data Storage

Everything local, nothing uploaded:

```
~/.nodum/
├── projects.json              # Index of all projects
└── my-project/
    ├── graph/graph.json      # Knowledge graph
    ├── memory/SUMMARY.md     # Project summary (auto-generated)
    └── logs/
        ├── activity.md
        └── YYYY-MM-DD.md     # Daily sync logs
```

### Claude Integration Features

- ✅ Automatic context on every response
- ✅ No manual context pasting
- ✅ Real-time graph access
- ✅ Search across entire codebase
- ✅ Dependency analysis
- ✅ Impact assessment (what breaks if I change X?)

---

## Use Cases

### 🔍 Code Review
```
"Review this PR — what's the impact?"
→ Claude analyzes all affected files using the graph
→ Shows complete dependency tree
```

### 🏗️ Architecture Questions
```
"Walk me through the auth flow from login page to API"
→ Claude traces through the graph
→ Builds accurate architecture diagram
```

### 🚀 Refactoring Safely
```
"Can I move this service to a separate module?"
→ Claude checks all dependents in the graph
→ Shows exact breaking points
→ Suggests refactoring plan
```

### 📚 Onboarding New Team Members
```
"Explain this project structure to me"
→ Claude understands actual architecture
→ No guessing, no hallucinations
→ Accurate explanation with real code references
```

---

## Performance

| Project Size | Scan Time | Graph Size |
|---|---|---|
| 50 files | ~5 sec | ~150 KB |
| 500 files | ~30 sec | ~2 MB |
| 1000+ files | ~1 min | ~5 MB |

---

## v2.0 Optimizations

Nodum v2.0 introduces **semantic search and hierarchical clustering** to maximize token efficiency:

### 📊 Multi-Turn Caching (Phase 1)
- Detects related queries within a conversation
- Reuses context from previous searches
- **Token savings: 83% on cache hits** (300 → 50 tokens)

### 🧠 Semantic Search (Phase 2)
- Uses embeddings for meaning-aware node discovery
- Combines semantic + keyword scoring (60/40 blend)
- **20% better node selection** than keyword-only search
- Graceful fallback to keywords if embeddings unavailable

### 🔗 Hierarchical Clustering (Phase 3)
- Groups related nodes by file/type/proximity
- Shows cluster summaries instead of listing all nodes
- Cluster expansion on demand via `expand_cluster` tool
- **~68% token savings** vs full graph dump (341 nodes → 19 clusters)

**Combined Impact:** Up to **83% token reduction** on repeated queries + **68% reduction** on context size = **Nodum is 5-6x more efficient than raw graph dumps.**

---

## How It Works

### 1. Code Scanning
Uses language-specific parsers to extract:
- Files and their groups (ui, service, model, etc.)
- Functions, classes, interfaces
- Imports and dependencies

### 2. Graph Generation
Builds a directed graph:
- **Nodes**: files, functions, classes
- **Edges**: imports, calls, extends, implements

### 3. Storage
Saves to `~/.nodum/projectname/`:
- `graph.json` — the knowledge graph
- `SUMMARY.md` — auto-generated project summary
- `activity.md` — sync history

### 4. Claude Access via MCP
- Nodum MCP server exposes 8 tools
- Claude Code calls these tools on demand
- Graph stays local, nothing uploaded

---

## Supported Languages

| Language | File Types | What's Extracted |
|---|---|---|
| TypeScript | .ts, .tsx | imports, functions, classes, interfaces |
| JavaScript | .js, .jsx | imports, functions, classes |
| Python | .py | imports, functions, classes (via AST) |
| Kotlin | .kt | imports, functions, classes, objects |
| Java | .java | imports, methods, classes |

More coming in v2!

---

## Benchmarks

We measure RAG effectiveness with our benchmark suite:

**v2.0 Token Efficiency:**
- ✅ **83% token savings** on repeated queries (multi-turn caching)
- ✅ **68% token savings** via hierarchical clustering vs raw dumps
- ✅ **20% better semantic search** vs keyword-only lookup
- ✅ **90%+ accuracy** on code reference identification

**Answer Quality:**
- ✅ 20% improvement in completeness with graph context
- ✅ Better architecture understanding for refactoring questions
- ✅ More accurate dependency tracking

See [benchmarks/README.md](./benchmarks/README.md) for detailed methodology and results.

---

## Project Structure

```
nodum/
├── packages/
│   ├── core/           # Code parsing + graph generation
│   ├── cli/            # Command-line interface
│   ├── server/         # HTTP server (3D viewer)
│   └── mcp/            # MCP server (Claude integration)
├── benchmarks/         # Token efficiency benchmarks & demos
├── docs/
│   ├── guides/         # Getting started & usage
│   │   ├── QUICKSTART.md
│   │   ├── SETUP-GUIDE.md
│   │   └── RUN.md
│   ├── architecture/   # Technical deep dives
│   │   ├── MCP.md
│   │   └── SMART-CONTEXT.md
│   └── development/    # Contributing & planning
│       ├── PUBLISH.md
│       ├── ROADMAP.md
│       └── LAUNCH.md
├── README.md           # Main readme (you are here)
├── CHANGELOG.md        # Release notes
└── CLAUDE.md           # Project context for Claude
```

---

## Installation Options

### Global Install (Recommended)
```bash
npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
nodum sync
```

### Local Install
```bash
npm install @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
npx nodum sync
```

### From Source
```bash
git clone https://github.com/caiquebrito/nodum
cd nodum
npm install
npm run build
npm install -g .
```

---

## Roadmap

### ✅ v2.0.0 (Current)
- **Multi-Turn Caching** — 83% token savings on repeated queries
- **Semantic Search** — meaning-aware node discovery with embeddings
- **Hierarchical Clustering** — 68% token reduction via smart grouping
- **expand_cluster tool** — on-demand cluster expansion
- TypeScript/Node.js monorepo
- 5 language parsers
- MCP integration for Claude
- 3D graph viewer
- Benchmark suite
- CLI with optional path (defaults to cwd)

### 📋 v2.1.0 (Planned)
- **Incremental sync** — 10-100x faster for large projects
- **Graph diffing** — see what changed
- **Architecture violations** — detect bad patterns
- **Dead code detection** — find unused code
- `nodum watch` — auto-sync on file changes
- Enhanced CLI (config, export, etc.)

### 🔮 v3.0.0 (Vision)
- Multi-language expansion (Go, Rust, C++, C#)
- Type flow analysis
- Data flow graphs
- IDE extensions (VS Code, JetBrains)
- Self-hosted server
- Team collaboration features

See [ROADMAP.md](./ROADMAP.md) for full details.

---

## Documentation

**Getting Started:**
- **[Quick Start](./docs/guides/QUICKSTART.md)** — 5-minute setup
- **[Setup Guide](./docs/guides/SETUP-GUIDE.md)** — Complete integration walkthrough
- **[Running Nodum](./docs/guides/RUN.md)** — CLI commands and usage

**Architecture:**
- **[MCP Integration](./docs/architecture/MCP.md)** — MCP architecture and API
- **[Smart Context](./docs/architecture/SMART-CONTEXT.md)** — v2.0 optimizations

**Development:**
- **[Publishing](./docs/development/PUBLISH.md)** — npm publishing details
- **[Roadmap](./docs/development/ROADMAP.md)** — Future features (v2.1+)
- **[Launch Strategy](./docs/development/LAUNCH.md)** — Release planning

**Benchmarks:**
- **[Benchmarks](./benchmarks/README.md)** — Token efficiency metrics and v2.0 results

---

## FAQ

**Q: Is my code uploaded anywhere?**
A: No. Everything stays local in `~/.nodum/`. Nothing touches the cloud.

**Q: Do I need the MCP server to use the CLI/viewer?**
A: No. `nodum sync` and `nodum serve` work standalone. MCP is optional for Claude integration.

**Q: How much disk space does it use?**
A: ~5 MB per 1000 files. Completely depends on project size.

**Q: Can I delete ~/.nodum/?**
A: Yes. It's safe to delete anytime. Just rescan with `nodum sync` to rebuild.

**Q: What languages does it support?**
A: TypeScript, JavaScript, Python, Kotlin, Java. More coming in v2.

**Q: Is this production-ready?**
A: Yes! v1.1.1 is stable and in active use. Roadmap is public, contributions welcome.

**Q: Can I self-host the MCP server?**
A: Not yet. v2 will support self-hosting. Currently: local only.

---

## Contributing

Found a bug? Have a feature idea? Open an issue or PR!

- **Issues**: https://github.com/caiquebrito/nodum/issues
- **Discussions**: https://github.com/caiquebrito/nodum/discussions

---

## License

MIT — use freely, modify, distribute. See [LICENSE](./LICENSE).

---

## Links

- 📦 **npm** (main): https://www.npmjs.com/package/@caiquebrito/nodum-cli
- 🤖 **npm** (MCP): https://www.npmjs.com/package/@caiquebrito/nodum-mcp
- 🐙 **GitHub**: https://github.com/caiquebrito/nodum
- 💬 **Discussions**: https://github.com/caiquebrito/nodum/discussions

---

## Made With

- **TypeScript** — type safety
- **Node.js** — runtime
- **3d-force-graph** — 3D visualization
- **Model Context Protocol** — Claude integration
- **Commander.js** — CLI
- **Express.js** — HTTP server

---

## Credits

Built by **Caique Brito** in Brazil 🇧🇷

Inspired by the need for Claude to understand entire codebases without constant re-explanation.

---

**[Get Started Now →](./SETUP-GUIDE.md)**

**Version 1.1.1** · MIT License · No cloud, no subscriptions, no BS.
