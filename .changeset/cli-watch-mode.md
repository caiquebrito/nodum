---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-cli": minor
---

`nodum watch [projectPath]` — watches a project and automatically runs an incremental sync on file changes (debounced, default 500ms, configurable via `--debounce`). Reuses the same `.gitignore`/`.nodumrc.json` rules as `nodum sync`/`nodum config`. Exports `IGNORED_DIRS` from `nodum-core` so watch mode can skip watching `node_modules`, `.git`, etc. at the filesystem level.
