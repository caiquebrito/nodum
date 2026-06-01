# Nodum — Quick Start Guide

Get nodum running in **3 steps**.

## 1. Build Everything

From the nodum repo root:

```bash
cd /Users/caiquebrito/Documents/Repositories/nodum

# Install dependencies (one time)
npm install

# Build all packages
npm run build
```

Takes ~30 seconds. Builds TypeScript in `packages/*/dist/`.

## 2. Try the CLI

```bash
# Scan nodum project itself
node packages/cli/dist/bin/nodum.js sync /Users/caiquebrito/Documents/Repositories/nodum

# Check what was scanned
node packages/cli/dist/bin/nodum.js status
```

Data saved to `~/.nodum/` (your home directory).

Output:
```
✅ Synced: nodum
  📁 30 files
  ⚙️  287 functions
  📦 8 classes
  🔗 311 dependencies

Data saved to: /Users/[you]/.nodum/nodum
```

## 3. Run the Benchmark (Optional)

```bash
# Install benchmark dependencies
cd benchmarks
npm install

# Run benchmark on the sample project
npm run run:sample
```

Takes ~10-15 minutes. Generates HTML report: `benchmark-report-sample-next-app-[timestamp].html`

---

## File Paths (For Reference)

| What | Path |
|------|------|
| **Nodum project** | `/Users/caiquebrito/Documents/Repositories/nodum` |
| **Data files** | `~/.nodum/` (auto-created) |
| **CLI executable** | `packages/cli/dist/bin/nodum.js` |
| **Benchmark** | `benchmarks/harness.ts` |
| **Sample project** | `benchmarks/projects/sample-next-app/` |

---

## Common Commands

```bash
# From nodum root:

# 1. Build
npm run build

# 2. Sync a project
node packages/cli/dist/bin/nodum.js sync /path/to/project

# 3. View synced projects
node packages/cli/dist/bin/nodum.js status

# 4. Start 3D visualizer
node packages/cli/dist/bin/nodum.js serve

# 5. Run benchmark
cd benchmarks && npm run run:sample
```

---

## What Gets Created

After running `nodum sync`, you'll have:

```
~/.nodum/
├── projects.json                 # Project index
└── [project-name]/
    ├── graph/graph.json         # Knowledge graph (nodes + edges)
    ├── memory/SUMMARY.md        # Project summary
    └── logs/
        ├── activity.md          # Sync history
        └── YYYY-MM-DD.md        # Session logs
```

Also: `CLAUDE.md` injected into the scanned project with RAG context.

---

## Troubleshooting

### Error: "Cannot find module @caiquebrito/nodum-core"
```bash
# Make sure you've built core first
npm run build
```

### Error: "ANTHROPIC_API_KEY not found"
For benchmark only. Set it:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
cd benchmarks && npm run run:sample
```

### Error: "No such file or directory: .nodum"
It gets created automatically. Run `nodum sync` first.

### Want to delete all data?
```bash
rm -rf ~/.nodum/
```

---

## Next: Make It Easier

Once this works, we can:

1. **Create npm script aliases** so you don't type the long path
2. **Create a global `nodum` command** (install via npm)
3. **Add a UI** (use the built-in 3D visualizer)
4. **Add configuration** for custom data paths

Want to set any of those up?
