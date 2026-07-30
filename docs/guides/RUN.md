# Running Nodum

The full CLI command reference. Install first (see [Quick Start](./QUICKSTART.md)):

```bash
npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
```

Everything below assumes the global `nodum` command. Building from source instead? Prefix each
command with `node packages/cli/dist/bin/nodum.js` from the repo root after `npm run build`.

---

## Sync & Setup

```bash
nodum init                    # Interactive setup: sync + Claude Code MCP integration
nodum sync                    # Scan the current directory
nodum sync /path/to/project   # Or an explicit path
nodum sync --incremental      # Only re-parse changed files
nodum watch                   # Auto-sync on file changes
nodum status                  # List all synced projects
```

## Configuration

```bash
nodum config                                     # Show current scan config
nodum config --set-include "src/**"              # Include patterns
nodum config --set-exclude "**/*.gen.ts"         # Exclude patterns
nodum config --set-architecture-rules "ui:repo"  # Declare layer rules
```

## Graph Analysis

```bash
nodum cycles                       # Detect circular imports
nodum dead-code                    # Find files nothing imports
nodum architecture                 # Check for architecture-rule violations
nodum complexity                   # Rank functions by cyclomatic complexity
nodum complexity --cognitive       # Rank by cognitive (nesting-aware) complexity
nodum duplicates                   # Find structurally duplicated code
nodum duplicates --fuzzy           # Near-duplicate (MinHash) grouping
nodum trace-impact <path> <id>     # Cascade of changes if you modify a node
nodum bottlenecks                  # Complexity x dependents composite ranking
nodum explain-architecture         # Layer/dependency overview + violations
nodum similar-code <path> <id>     # Structurally near-identical code to a node
nodum suggest-refactoring          # Unified suggestions from all of the above
```

## Export & Diff

```bash
nodum export --format graphml   # JSON, GraphML, or CSV
nodum diff <a> <b>              # Compare two graph snapshots
```

## Viewer

```bash
nodum serve
```

Opens the 3D graph viewer at `http://localhost:7842`, bound to `127.0.0.1` by default. Override
with `NODUM_PORT` and `NODUM_HOST` — only widen `NODUM_HOST` beyond loopback (e.g. `0.0.0.0` in a
container) if you understand the server has no authentication and anyone who can reach that
address can read every synced project's graph.

---

## Data Location

```
~/.nodum/
├── projects.json                 # Project index
└── [project-name]/
    ├── graph/graph.json         # Knowledge graph (nodes + edges)
    ├── memory/SUMMARY.md        # Project summary
    └── logs/
        ├── activity.md          # Sync history
        └── metrics.jsonl        # Per-response token-efficiency log
```

To reset everything: `rm -rf ~/.nodum/`.

## Next

- [Setup Guide](./SETUP-GUIDE.md) — Claude Code / MCP integration walkthrough
- [MCP Integration](../architecture/MCP.md) — the MCP server's architecture and tool list
