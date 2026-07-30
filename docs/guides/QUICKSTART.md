# Nodum — Quick Start Guide

Get nodum running in **3 steps**. (See [README.md](../../README.md) for the full picture — this
guide is the condensed version.)

## 1. Install

```bash
npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp
```

Prefer to build from source instead (e.g. you're contributing to nodum itself)? See
[Building from source](#building-from-source) below.

## 2. Sync a Project

```bash
cd ~/my-project
nodum sync
```

Output:
```
✅ Synced: my-project
  📁 30 files
  ⚙️  287 functions
  📦 8 classes
  🔗 311 dependencies

Data saved to: ~/.nodum/my-project
```

Check what's synced any time with `nodum status`.

## 3. Connect Claude Code

```bash
claude mcp add nodum -- nodum-mcp
```

Restart Claude Code, run `/mcp` to confirm `nodum` is connected, then just ask Claude about your
code — it now has real graph context. Full options (including a `.mcp.json`-based setup and the
"command not found" fix for PATH issues) are in the README's
[Quick Start](../../README.md#quick-start) section.

---

## What Gets Created

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

`nodum sync` also injects a knowledge-graph summary into the project's `CLAUDE.md`.

To reset everything: `rm -rf ~/.nodum/`.

---

## Troubleshooting

### "command not found: nodum" / "nodum-mcp"
The global npm bin isn't on your `PATH`. Run `npm config get prefix` and add
`<prefix>/bin` to your shell's `PATH`, or use the absolute-path MCP config shown in the README's
troubleshooting section.

### MCP server won't connect in Claude Code
Claude Code spawns the server without your shell's full `PATH` — see
[README → "command not found" / server won't connect](../../README.md#quick-start) for the
absolute-path fix.

---

## Building from Source

Only needed if you're developing nodum itself:

```bash
git clone https://github.com/caiquebrito/nodum
cd nodum
npm install
npm run build

# Run the CLI without installing it globally:
node packages/cli/dist/bin/nodum.js sync .
node packages/cli/dist/bin/nodum.js status
```

## Next

- [Running Nodum](./RUN.md) — the full CLI command reference
- [Setup Guide](./SETUP-GUIDE.md) — detailed MCP integration walkthrough
- [Contributing](../../CONTRIBUTING.md) — the spec-driven dev workflow, if you're building nodum itself
