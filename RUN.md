# How to Run Nodum Right Now

Everything is built and ready. Here are the 3 simplest ways to use it:

---

## Option 1: Use the Full Path (No Setup)

```bash
cd /Users/caiquebrito/Documents/Repositories/nodum

# Build (only once)
npm run build

# Then use directly:
node packages/cli/dist/bin/nodum.js sync /path/to/your/project
node packages/cli/dist/bin/nodum.js status
node packages/cli/dist/bin/nodum.js serve
```

**Data files:** `~/.nodum/` (auto-created)

---

## Option 2: Create Simple Alias (Recommended)

Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
alias nodum="node /Users/caiquebrito/Documents/Repositories/nodum/packages/cli/dist/bin/nodum.js"
```

Then reload:
```bash
source ~/.zshrc  # or ~/.bashrc
```

Now use:
```bash
nodum sync /path/to/project
nodum status
nodum serve
```

---

## Option 3: Run the Benchmark

```bash
cd /Users/caiquebrito/Documents/Repositories/nodum/benchmarks

# Install once
npm install

# Run against sample project
npm run run:sample

# Or your own project:
npm run run -- /path/to/project
```

Report saves as: `benchmark-report-[project]-[timestamp].html`

---

## What Each Command Does

| Command | Does What | Output |
|---------|-----------|--------|
| `nodum sync PROJECT` | Scans and indexes a project | `~/.nodum/[project]/graph.json` |
| `nodum status` | Shows all synced projects | Lists projects + file counts |
| `nodum serve` | Starts 3D visualizer | Opens http://localhost:7842 |

---

## Test It Now

```bash
# 1. Build
cd /Users/caiquebrito/Documents/Repositories/nodum
npm run build

# 2. Test on nodum itself
node packages/cli/dist/bin/nodum.js sync /Users/caiquebrito/Documents/Repositories/nodum

# 3. Check it worked
node packages/cli/dist/bin/nodum.js status

# 4. View the data
cat ~/.nodum/nodum/memory/SUMMARY.md

# 5. See the CLAUDE.md that was injected
head -10 /Users/caiquebrito/Documents/Repositories/nodum/CLAUDE.md
```

---

## Data Location

All data goes to a **fixed path** you suggested:

```
~/.nodum/                           # /Users/[you]/.nodum
├── projects.json                   # Project index
└── [project-name]/
    ├── graph/graph.json           # Knowledge graph
    ├── memory/SUMMARY.md          # Project summary  
    └── logs/
        ├── activity.md            # Sync history
        └── YYYY-MM-DD.md          # Daily logs
```

To **reset everything:**
```bash
rm -rf ~/.nodum/
```

---

## Next Steps

Once you confirm it works:

1. **Install globally** — `npm install -g` to use as a real CLI tool
2. **Run benchmark** — See actual numbers on your project
3. **Build MCP** — Integrate with Claude AI
4. **Publish** — Share on npm

Want to try it now?
