# Nodum Roadmap

## ✅ Version 1.1.0 (Current - Published)

### Core Features
- ✅ Code graph generation (TypeScript, Python, Kotlin, Java)
- ✅ Knowledge graph with nodes (files, functions, classes) and edges (dependencies)
- ✅ CLI: `nodum sync`, `nodum serve`, `nodum status`
- ✅ 3D interactive graph viewer (localhost:7842)
- ✅ Benchmark suite for measuring RAG effectiveness
- ✅ CLAUDE.md context injection into projects
- ✅ Data storage: `~/.nodum/`

### Claude Integration
- ✅ MCP server with 8 tools:
  - `sync_project` - Scan and build graphs
  - `project_status` - List synced projects
  - `get_graph` - Fetch complete graph
  - `search_graph` - Find code by name
  - `get_node` - Get node details
  - `get_dependencies` / `get_dependents` - Trace relationships
  - `analyze_file` - Deep dive into files
- ✅ Claude Code integration
- ✅ NPM packages published:
  - `@caiquebrito/nodum` (CLI + Server + Core)
  - `@caiquebrito/nodum-mcp` (Claude MCP Server)

### Documentation
- ✅ SETUP-GUIDE.md - Complete integration guide
- ✅ PUBLISH.md - npm publishing instructions
- ✅ MCP.md - Architecture details
- ✅ QUICKSTART.md - Quick start
- ✅ RUN.md - How to run locally

---

## 📋 Version 2.0.0 (Planned)

### Incremental Sync (Priority: High)
- [ ] File-level diffing (only rescan changed files)
- [ ] Incremental graph updates (merge deltas)
- [ ] `nodum sync --incremental` flag
- [ ] Metadata tracking (file hashes, timestamps)
- [ ] Cache invalidation logic

**Impact:** 10-100x faster syncs for large projects (1000+ files)

### Enhanced CLI
- [ ] `nodum watch` - Auto-sync on file changes
- [ ] `nodum init` - Project setup wizard
- [ ] `nodum config` - Customize scan patterns
- [ ] `nodum export` - Export graph as JSON/GraphML
- [ ] Performance metrics in `nodum status`

### Graph Features
- [ ] Chunked storage (files.json, functions.json, etc.)
- [ ] Graph versioning (track history)
- [ ] Dependency cycle detection
- [ ] Architecture violation detection
- [ ] Dead code detection

### MCP Enhancements
- [ ] `suggest_refactoring` - AI refactoring suggestions
- [ ] `find_bottlenecks` - Performance analysis
- [ ] `trace_impact` - Show what breaks if you change X
- [ ] `explain_architecture` - Auto-generate architecture docs
- [ ] Real-time graph updates via watch

### Server Features
- [ ] WebSocket support for live updates
- [ ] Graph comparison (v1 vs v2)
- [ ] Collaborative annotations (Claude notes)
- [ ] Export 3D graph as image/video

---

## 📈 Version 3.0.0 (Future Vision)

### Multi-Language Support Expansion
- [ ] Go, Rust, C++, C#
- [ ] JavaScript/Node regex improvement
- [ ] Ruby, PHP support
- [ ] SQL schema parsing

### Advanced Analysis
- [ ] Type flow analysis
- [ ] Data flow graphs
- [ ] Control flow analysis
- [ ] Security vulnerability detection

### IDE Integration
- [ ] VS Code extension
- [ ] JetBrains plugin
- [ ] Inline Claude suggestions

### Telemetry & Analytics
- [ ] Anonymous usage metrics
- [ ] Graph complexity scoring
- [ ] Codebase health reports
- [ ] Team collaboration insights

### Enterprise Features
- [ ] Self-hosted server
- [ ] Multi-project workspaces
- [ ] Role-based access control
- [ ] Graph encryption

---

## 🎯 Immediate Next Steps (Pick One)

### Option 1: Launch & Gather Feedback
- [ ] Share nodum on Product Hunt / Hacker News
- [ ] Get real-world usage feedback
- [ ] Identify pain points
- [ ] Build v2 based on user needs

### Option 2: Build v2 Incremental Sync
- [ ] Implement file diffing
- [ ] Add `--incremental` flag
- [ ] Test on large projects (10k+ files)
- [ ] Benchmark speed improvements

### Option 3: Expand MCP Tools
- [ ] Add refactoring suggestions tool
- [ ] Add architecture explanation tool
- [ ] Add impact analysis tool
- [ ] User test with Claude Code

---

## 📊 Success Metrics

By end of 2026:

- ✅ 500+ GitHub stars
- ✅ 1000+ npm downloads/month
- ✅ 5+ production users
- ✅ Measurable Claude helpfulness increase

---

## 🤝 Community

- [ ] GitHub discussions enabled
- [ ] Twitter updates
- [ ] Blog post on RAG + code graphs
- [ ] Show & Tell demos

---

## 💡 Notes

### Technical Debt
- Graph storage in single JSON (needs chunking at 10k+ nodes)
- No persistent activity logs
- Limited error handling in MCP

### Known Limitations
- Graph rebuilds entire project (slow for 1000+ files)
- Limited to files in git (ignores .gitignore)
- No type resolution across files
- MCP tools are read-only

### Design Decisions
- File-based storage (~/.nodum/) for simplicity
- No database requirement (users love this!)
- Public npm packages (transparent, easy to fork)
- MCP over proprietary API (follows standards)

---

## 🚀 Final Thought

Nodum is a **knowledge graph for your code**. With Claude as the interface, it becomes:
- A smarter code reviewer
- An architecture advisor
- A refactoring guide
- A codebase teacher

v1 proves the concept. v2 scales it. v3 makes it indispensable.

---

**Questions?** Create an issue on GitHub or reach out!
