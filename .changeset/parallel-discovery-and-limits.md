---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
"@caiquebrito/nodum-mcp": minor
---

File discovery (`discoverFiles`/`discoverChangedFiles`) now reads/hashes files with bounded concurrency instead of sequentially — a real wall-clock win on larger projects, with byte-identical output (verified against a frozen real-project snapshot, including cluster assignment).

Adds file-size and file-count sync guardrails, configurable via `.nodumrc.json`: `maxFileSizeBytes` (default 2 MB) excludes an oversized file individually with a warning rather than reading/parsing it; `maxFilesWarning` (default 20,000) warns once a project's file count crosses the threshold, without truncating the sync. Warnings surface through the CLI (`console.warn`) and the MCP server's `sync_project` response text.

Also fixes a latent tree-sitter parser safety issue: `TreeSitterParser` no longer memoizes a single shared `TSParser` per instance for its whole lifetime — each parse now gets its own `TSParser` bound to the already-shared, genuinely-immutable `Language`, matching what the underlying grammar loader was already doing correctly. WASM-allocated parse trees are now freed (`tree.delete()`) once node/edge extraction completes, across all 5 tree-sitter-backed languages (Python, Java, JavaScript, Swift, Objective-C).

Third and final spec in the v2.8.0 "adaptive context budgeting" batch.
