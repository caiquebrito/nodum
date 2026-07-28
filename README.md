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
- **TypeScript** (.ts, .tsx) — via the TypeScript compiler API (real resolved-type data)
- **Python, Java, JavaScript, Swift, Objective-C** (.py, .java, .js/.jsx, .swift, .m/.h) — via [tree-sitter](https://tree-sitter.github.io/tree-sitter/) (real AST, not regex)
- **Kotlin** (.kt) — line-regex for now, tree-sitter migration planned (see [ROADMAP.md](./docs/development/ROADMAP.md))
- **More coming** (KMP, Flutter, Go)

Extracts: files, functions, classes, interfaces, methods, imports, and same-file `calls` edges

### 🧠 Builds a Knowledge Graph
```
Files ──imports──> Files
  ├─ Functions ──calls──> Functions   (same-file, bare calls — e.g. foo())
  ├─ Methods ──calls──> Methods       (same-file, bare calls only — not this.x())
  ├─ Classes ──extends──> Classes
  └─ Interfaces ──implements──> Interfaces
```

Stored at `~/.nodum/projectname/graph/graph.json`

### 🤖 Claude Integration via MCP
14 tools Claude can use:
- `sync_project` — Scan a project
- `get_graph` — Fetch the knowledge graph
- `search_graph` — Find functions/classes/files with semantic search (v2.0)
- `get_node` — Details about a code element
- `get_dependencies` — What does X depend on?
- `get_dependents` — What depends on X (one hop)?
- `analyze_file` — Deep dive into a file
- `expand_cluster` — Explore grouped code regions (v2.0)
- `project_status` — List all synced projects
- `trace_impact` — Show the full transitive cascade of changes if you modify X (v2.1)
- `find_bottlenecks` — Rank files by complexity × how many files depend on them (v2.1)
- `explain_architecture` — Auto-generate a layer/dependency overview + rule violations (v2.1)
- `find_similar_code` — Find structurally near-identical functions to a given node (v2.1)
- `suggest_refactoring` — Unified suggestions: cycles, dead code, violations, complexity, duplication (v2.1)

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
nodum sync --incremental      # Only re-parse changed files (v2.1)
nodum watch                   # Auto-sync on file changes (v2.1)
nodum init                    # Interactive setup: sync + Claude Code integration

# Configuration
nodum config                                     # Show scan config
nodum config --set-include "src/**"              # Include patterns
nodum config --set-exclude "**/*.gen.ts"         # Exclude patterns
nodum config --set-architecture-rules "ui:repo"  # Declare layer rules (v2.1)

# Graph analysis (v2.1)
nodum cycles                       # Detect circular imports
nodum dead-code                    # Find files nothing imports
nodum architecture                 # Check for architecture-rule violations
nodum complexity                   # Rank functions by cyclomatic complexity
nodum duplicates                   # Find structurally duplicated code
nodum trace-impact <path> <id>     # Cascade of changes if you modify a node
nodum bottlenecks                  # Complexity x dependents composite ranking
nodum explain-architecture         # Layer/dependency overview + violations
nodum similar-code <path> <id>     # Structurally near-identical code to a node
nodum suggest-refactoring          # Unified suggestions from all of the above

# Export & diff
nodum export --format graphml   # JSON, GraphML, or CSV
nodum diff <a> <b>              # Compare two graph snapshots

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

## Token Efficiency

Nodum uses **semantic search and hierarchical clustering** to avoid dumping the entire graph into
context on every query:

### 📊 Multi-Turn Caching (Phase 1)
- Detects related queries within a conversation
- Reuses context from previous searches (faster — a cache hit skips re-scoring, though it returns
  the same context a fresh search would have found, so it isn't a separate token saving)

### 🧠 Semantic Search (Phase 2)
- Uses embeddings for meaning-aware node discovery
- Combines semantic + keyword scoring (60/40 blend)
- Graceful fallback to keywords if embeddings unavailable

### 🔗 Hierarchical Clustering (Phase 3)
- Groups related nodes by file/type/proximity
- Shows cluster summaries instead of listing all nodes
- Cluster expansion on demand via `expand_cluster` tool

**Where the real numbers live:** every `search_graph` response reports its own measured savings
against a full-graph-dump baseline — computed per call, not a fixed marketing percentage (v2.2.0
replaced the hardcoded figures this section used to quote with that real, per-response number).
Every MCP tool call is also logged to `~/.nodum/<project>/logs/metrics.jsonl`, so real-session
efficiency is inspectable directly rather than taken on faith.

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
- Nodum MCP server exposes 14 tools
- Claude Code calls these tools on demand
- Graph stays local, nothing uploaded

---

## Supported Languages

| Language | File Types | Parser | What's Extracted |
|---|---|---|---|
| TypeScript | .ts, .tsx | TypeScript compiler API | imports, functions, classes, interfaces, methods, same-file `calls` |
| Python | .py | tree-sitter | imports, functions, classes, methods, same-file `calls` |
| Java | .java | tree-sitter | imports, methods, constructors, classes, interfaces, same-file `calls` |
| JavaScript | .js, .jsx | tree-sitter | imports, functions, classes, methods, same-file `calls` |
| Swift | .swift | tree-sitter | imports, classes, structs, enums, actors, extensions, protocols, methods, same-file `calls` |
| Objective-C | .m, .h | tree-sitter | imports, classes, categories/extensions, protocols, methods, C functions, same-file `calls` (incl. `self`/`super` message sends) |
| Kotlin | .kt | line-regex | imports, functions, classes, objects (no `calls` edges yet) |

Python, Java, and JavaScript migrated from line-regex to tree-sitter in v2.6.0; Swift and
Objective-C support shipped in v2.7.0, including cross-language import resolution — a Swift
`import Foo` resolves to `Foo`'s Objective-C files and vice versa, so a mixed project renders as
one connected graph. See [ROADMAP.md](./docs/development/ROADMAP.md) for details. Kotlin's
tree-sitter grammar isn't accurate enough yet (~61% structural fidelity in its own upstream
benchmark), so it stays on regex until a better one exists.

---

## Benchmarks

`benchmarks/` measures RAG effectiveness against a small fixture project, gated in CI
(`.github/workflows/benchmark-accuracy.yml`) — a token-efficiency or accuracy regression fails
the build. Its original v2.0 figures (~83%/68%/20%/90%) were the initial design targets rather
than numbers with confidence intervals behind them; the trustworthy, up-to-date signal is the
real per-response percentage every `search_graph` call now reports (see Token Efficiency above)
and the per-session log at `~/.nodum/<project>/logs/metrics.jsonl`.

See [benchmarks/README.md](./benchmarks/README.md) for the suite's methodology.

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

40 specs shipped so far, each with real end-to-end verification against synced projects — see
[`docs/development/completed/`](./docs/development/completed/). Current published version is
**v2.7.0** across all four packages (lockstep).

### ✅ iOS: Swift + Objective-C (shipped as v2.7.0)
- Full Swift and Objective-C parsers via tree-sitter — classes, structs, enums, protocols,
  extensions/categories, methods, real complexity, `duplicateHash`, same-file `calls` edges
- Unified cross-language import resolution — a Swift `import Foo` resolves to `Foo`'s
  Objective-C files and vice versa, so a mixed project renders as one connected graph instead of
  two disconnected islands
- Zero changes to core graph-generation code required — proves the tree-sitter parser plugin
  architecture (v2.6.0) generalizes to a language family sharing nothing with the parsers that
  existed before it

### ✅ Tree-sitter foundation + `calls` edges (shipped as v2.6.0)
- Python, Java, and JavaScript migrated from line-regex to real tree-sitter ASTs; TypeScript stays
  on the compiler API for its resolved-type data
- New same-file `calls` edges (bare-identifier calls, e.g. `foo()` — not `this.foo()`)
- Python gets real cross-file imports for the first time; JavaScript gets `line` numbers and real
  class-member extraction for the first time; Java gets constructor extraction

### ✅ Truth & measurement (shipped as v2.5.0)
- Real token accounting on every `search_graph` response — no more hardcoded percentage strings
- Fixed an unbounded-context bug where a hub file's dependents could blow context open
- Benchmark suite moved into CI and gated on every PR

### ✅ v2.1.0 — Speed & scale
- **Incremental sync** — file-hash-based change detection, `nodum sync --incremental`
- **`nodum watch`** — auto-sync on file changes
- **Enhanced CLI** — `init`, `config`, `export` (JSON/GraphML/CSV), `diff`
- **Real cross-file import edges** — TS/JS/Kotlin/Java import resolution
- **5 analyzers** — `cycles`, `dead-code`, `architecture`, `complexity`, `duplicates`
- **5 MCP tools** — `trace_impact`, `find_bottlenecks`, `explain_architecture`, `find_similar_code`, `suggest_refactoring`

### ✅ v2.0.0
- **Multi-Turn Caching** — reuses context across related queries in a conversation
- **Semantic Search** — meaning-aware node discovery with embeddings
- **Hierarchical Clustering** — cluster summaries instead of a full node dump
- **expand_cluster tool** — on-demand cluster expansion
- TypeScript/Node.js monorepo, 5 language parsers, MCP integration, 3D graph viewer, benchmark suite

### 🔜 Next: adaptive context budgeting, then cross-platform mobile (KMP, Flutter, Go)
### 🔮 v3.0.0 — reframed as MCP-native, not a multi-AI adapter hub

The original v3.0 vision was per-provider adapters (OpenAI, Gemini, Ollama). MCP already gives
that for free — any MCP client (Claude Code, Cursor, Zed, Continue) can use Nodum today with zero
per-provider code. v3.0 is now about graph quality (type flow, data-flow edges) and a hardened,
verified-multi-client MCP server, not adapter breadth.

See [ROADMAP.md](./docs/development/ROADMAP.md) for the full plan and the reasoning behind it.

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
A: TypeScript, Python, Java, JavaScript, Swift, and Objective-C (all real AST-based parsing —
TypeScript via the compiler API, the rest via tree-sitter), and Kotlin (still line-regex, pending
its own tree-sitter migration).

**Q: Is this production-ready?**
A: Yes — v2.7.0 is stable and in active use. Roadmap is public, contributions welcome.

**Q: Can I self-host the MCP server?**
A: Not yet — local only for now. Self-hosting isn't on the near-term roadmap; the MCP server is designed to run alongside your own Claude Code session, not as a shared service.

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

**Version 2.7.0** · MIT License · No cloud, no subscriptions, no BS.
