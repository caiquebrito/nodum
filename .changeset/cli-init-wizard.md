---
"@caiquebrito/nodum-cli": minor
---

`nodum init [projectPath]` — interactive setup wizard: offers to run the initial sync and to wire up `.mcp.json` for Claude Code. When setting up `.mcp.json`, automatically resolves absolute paths for `node`/`nodum-mcp` (the same manual `which` steps documented in the README's troubleshooting section), and merges into any existing `.mcp.json` rather than overwriting it. Fails fast with a clear message in non-interactive contexts (CI, piped input) instead of hanging.
