# nodum — Local Code Memory for Claude

> A self-hosted knowledge graph that gives Claude persistent memory about your projects — with an interactive 3D visualizer.

![Knowledge Graph](https://img.shields.io/badge/viewer-3D_graph-58a6ff?style=flat-square)
![Python](https://img.shields.io/badge/python-3.9+-3fb950?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-bc8cff?style=flat-square)
![No cloud](https://img.shields.io/badge/cloud-none-ff9f1a?style=flat-square)
![Made in Brazil](https://img.shields.io/badge/made%20in-Brazil%20🇧🇷-009c3b?style=flat-square)

---

## The Problem

Every time you open a new Claude Code session, it starts from scratch. You explain your stack again. Re-describe the architecture. Paste the same file paths over and over. Claude is smart, but it has no memory — and this constant re-explanation wastes time and breaks your train of thought.

The common solution is to dump everything into `CLAUDE.md`. But that becomes a mess quickly: no structure, no automation, outdated as soon as the code changes, and you still write it all manually.

---

## The Idea

What if Claude always knew about your project — the files, functions, dependencies, the decisions you made last week — without you needing to explain it again?

That's what nodum does. A **local knowledge graph** that lives alongside your projects:

- Scans your code and builds a structured map of files, functions, classes, and imports
- Automatically detects your stack (Android, Kotlin, Python, Go, Rust, Docker…) and generates a project summary
- Maintains session logs — what Claude worked on each day, what was decided, what's next
- Injects context into `CLAUDE.md` so Claude reads the graph before answering **anything**
- Serves an **interactive 3D visualizer** — orbit, zoom, click nodes, see connections live

Everything runs locally. No API calls, no cloud, no subscription.

---

## How It Works

The goal was to keep it simple — no frameworks, no build step, no package managers. Just Python and vanilla JS.

The sync script (`scripts/sync.py`) reads your project files using Python's `ast` module for Kotlin/Java and regex patterns for other languages. It traverses the directory tree, extracts nodes (files, functions, classes) and edges (imports, definitions), and writes a `graph.json`. It also reads config files — `build.gradle`, `AndroidManifest.xml`, `settings.gradle`, `.env.example` — and generates a `SUMMARY.md` with stack, build variants, and environment variables already filled in.

The visualizer (`viewer/app.js`) uses [3d-force-graph](https://github.com/vasturiano/3d-force-graph) — a 3D force-directed graph in WebGL — to render your code as a living atom you can orbit and explore. Nodes are sized by connection count. Import edges have animated particles flowing through them. Click a node and a detail panel slides in showing everything it imports and everything that uses it.

The injection into `CLAUDE.md` forces Claude to print a formatted context block at the start of each session — stack, file count, last sync date, project summary — before answering anything.

---

## Demo

```
┌─ nodum Viewer (localhost:7842) ────────────────────────────────────┐
│                                                                      │
│  [Explorer]        [  ●  3D graph — orbit with mouse  ●  ]         │
│  ▼ app                                                               │
│    ▼ ui            Nodes glow by group: ui · service · model        │
│      MainActivity.kt 12  Particles flow along import edges          │
│        ƒ onCreate     Click a node → detail panel slides in         │
│        ƒ setupViews                                                 │
│    ▶ services    [ Logs ]   ── daily session logs ──                │
│    ▶ models      [ Memory ] ── SUMMARY.md of project ──             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
nodum/                        ← this repository
│
├── scripts/
│   ├── sync.py                ← scans a project and saves the data
│   └── graph_gen.py           ← AST parser (Kotlin/Java/Python/JS)
│
├── viewer/                    ← 3D visualizer (served via HTTP)
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── projects.json              ← index of all synced projects
│
└── <project-name>/            ← one folder per project
    ├── graph/graph.json       ← code graph (auto-generated)
    ├── memory/SUMMARY.md      ← project summary (generated + editable)
    └── logs/
        ├── activity.md        ← sync history
        └── 2024-01-15.md      ← daily session log

<your-project>/               ← your actual project (not modified)
    └── CLAUDE.md              ← RAG context injected here
```

Your actual projects **are never modified**, except for `CLAUDE.md`.

---

## Quick Start

### 1. Clone this repo

```bash
git clone https://github.com/caiquebrito/nodum ~/path/to/nodum
cd ~/path/to/nodum
```

No dependencies to install — just Python 3.9+ (standard library only).

### 2. Sync a project

```bash
python3 scripts/sync.py /path/to/your/android/project
```

This will:
- Parse all `.kt`, `.java`, `.gradle`, `.py`, `.js`, `.ts` files and generate the graph
- Auto-detect the stack from `build.gradle`, `package.json`, `pyproject.toml`, etc.
- Create `<project>/memory/SUMMARY.md` pre-filled with stack, build variants, and dependencies
- Write a `CLAUDE.md` in your project forcing Claude to load context each session
- Create a daily log in `<project>/logs/YYYY-MM-DD.md`

### 3. Start the visualizer

```bash
python3 serve.py
```

Opens `http://localhost:7842/` automatically. The 3D graph is interactive:
- **Drag** to orbit, **scroll** to zoom
- **Click** a node to see its connections in the detail panel
- **Hover** for tooltip with name, type, and file path
- **Sidebar** shows the real folder tree with functions nested under files
- **Sync button** rescans the current project's code (no terminal needed)
- **Memory button** shows the SUMMARY.md of the project
- **Logs button** navigates through daily session logs

### 4. Check project status

```bash
python3 scripts/sync.py --status
```

---

## Integration with Claude Code

After syncing, your project's `CLAUDE.md` will contain:

```markdown
## Knowledge Graph Context — Required

ABSOLUTE RULE: at the start of each session, BEFORE answering anything, you MUST:

1. Read the files listed below in order
2. Print a context block:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Knowledge Graph loaded: myapp
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Stack:      Android · Kotlin · Jetpack Compose
  Files:      127 files · 84 classes · 312 functions
  Last sync:  2024-01-15 14:32
  Memory:     Mobile app for tracking user workouts...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Claude reads the graph, memory, and logs **before each response** — and always knows the project without re-explaining.

### Skills for Claude Code

The `/rag-sync` skill is available for use during Claude Code sessions. More details and improvements coming soon.

#### Installing Skills

Nodum includes ready-to-use Claude Code skills in the `claude-skills/` folder. To use them in your project:

1. Copy the skills from nodum into your project's `.claude` folder:
   ```bash
   cp -r /path/to/nodum/claude-skills/* /path/to/your/project/.claude/
   ```

2. Skills are now available as slash commands (e.g., `/rag-sync`) during your Claude Code sessions.

If `.claude` folder doesn't exist in your project, Claude Code will create it automatically on first use.

---

## Automatically Detected Stack

The `sync.py` reads your project files and populates `memory/SUMMARY.md` automatically:

| File | What gets detected |
|------|-------------------|
| `build.gradle` | Language (Kotlin/Java), Android version, libraries, build flavors |
| `AndroidManifest.xml` | App name, permissions, Activities, Services |
| `settings.gradle` | Module structure and dependencies |
| `package.json` | Runtime (Node/Bun), language (TS/JS), frameworks (React, Next, Express…), ORMs, libraries |
| `pyproject.toml` / `requirements.txt` | Python + FastAPI / Django / Flask / SQLAlchemy |
| `go.mod` | Go + Gin / Echo / Fiber |
| `Cargo.toml` | Rust |
| `docker-compose.yml` | Docker Compose services |
| `.env.example` | All environment variable names |
| `Makefile` | Available `make` targets |
| `README.md` | First paragraph as project description |

Sections that can't be auto-detected (`## Dependencies On`, `## Exposes To`, `## Notes`) are left blank for you to fill.

---

## Supported Languages

| Language | Extensions | What gets extracted |
|----------|-----------|-----------------|
| Kotlin | `.kt` | imports, functions, classes, objects |
| Java | `.java` | imports, methods, classes |
| JavaScript | `.js`, `.mjs`, `.cjs` | imports, functions, classes |
| TypeScript | `.ts`, `.tsx` | imports, functions, classes, interfaces |
| JSX | `.jsx` | imports, functions, components |
| Python | `.py` | imports, functions, classes (via AST) |

---

## Project Memory Structure

```
<project-name>/
├── graph/
│   └── graph.json          # nodes (file/function/class) + edges (imports/defines)
├── memory/
│   └── SUMMARY.md          # auto-generated, freely editable
└── logs/
    ├── activity.md         # each sync recorded here
    ├── 2024-01-15.md       # daily session log (created by /rag-sync)
    └── 2024-01-16.md
```

### graph.json Format

```json
{
  "project": "myapp",
  "stats": { "files": 127, "functions": 312, "classes": 84, "edges": 498 },
  "nodes": [
    { "id": "app_ui_MainActivity_kt", "label": "MainActivity.kt", "type": "file",
      "file": "app/ui/MainActivity.kt", "group": "ui" },
    { "id": "app_ui_MainActivity_kt__onCreate", "label": "onCreate", "type": "function",
      "file": "app/ui/MainActivity.kt", "group": "ui" }
  ],
  "edges": [
    { "source": "app_ui_MainActivity_kt", "target": "app_services_LocationService_kt",
      "relation": "imports" }
  ]
}
```

### Node Groups

| Group | Directories |
|-------|-----------|
| `ui` | `ui/`, `fragments/`, `activities/`, `screens/` |
| `service` | `services/`, `service/` |
| `model` | `models/`, `data/`, `entities/`, `schema/` |
| `repo` | `repository/`, `repositories/` |
| `util` | `utils/`, `helpers/`, `lib/`, `common/` |
| `config` | `config/`, `settings/`, `di/` |
| `test` | `test/`, `tests/`, `androidTest/`, `unitTest/` |

---

## Visualizer Features

- **3D force graph** — nodes repel each other, camera orbits freely (WebGL via three.js)
- **Auto-fit on load** — graph always fits when switching projects
- **Size by degree** — more connected nodes appear larger
- **Animated particles on import edges** — points flow along dependency arrows
- **Sidebar with file tree** — same folder structure, functions nested under files
- **Project selector** — dropdown supporting unlimited projects
- **Sync button** — rescans code without leaving the interface (runs sync.py automatically)
- **Memory panel** — click Memory to read the SUMMARY.md
- **Session logs** — click Logs to browse daily session logs
- **Search** — find any function, file, or class in the graph
- **Detail panel** — click a node to see what it imports and what uses it
- **Export PNG** — download a screenshot of the current view
- **Auto-rotation** — smooth orbit when idle, pauses on interaction

---

## Command Reference

```bash
# Sync a project (create or update all data)
python3 scripts/sync.py /path/to/your/project

# Start the 3D visualizer on localhost:7842
python3 serve.py

# Check all synced projects with stats
python3 scripts/sync.py --status
```

| File | Written by | Contains |
|------|-----------|----------|
| `graph/graph.json` | sync (auto) | Code graph |
| `memory/SUMMARY.md` | sync + you | Project summary |
| `logs/activity.md` | sync (auto) | Sync history |
| `logs/YYYY-MM-DD.md` | Claude (`/rag-sync`) | Daily session log |
| `projects.json` | sync (auto) | Project index |

---

## Ignoring Files

The scanner ignores these directories by default:

```
node_modules  .git  dist  build  .next  __pycache__  coverage
.gradle  build/  .idea/  .DS_Store
```

---

## Contributing

PRs welcome. The code is intentionally simple — no build step, no package manager, no framework.

```
scripts/sync.py       ~330 lines  — orchestrator
scripts/graph_gen.py  ~200 lines  — AST parser
viewer/app.js         ~600 lines  — 3D visualizer (vanilla JS)
viewer/style.css      ~400 lines  — dark theme
serve.py               ~30 lines  — local HTTP server
```

---

## Author

Made with focus by **Lucas Amaral** — 🇧🇷 Brazil.

If this saved you time, consider buying a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/koalitos)

---

## License

MIT
