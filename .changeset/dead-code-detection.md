---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum dead-code [projectPath] [--json] [--entry <patterns>]` — find files no other tracked file imports, as candidates for dead-code review (not a definitive verdict — a real entry point wired up outside the parsed import graph looks identical to an orphan). Excludes test-group files and files matching a built-in entry-point-name heuristic (`index.*`, `main.*`, `*.config.*`, etc.), extensible via `--entry` for framework-specific routing conventions. `detectUnreachableFiles()` is exported from `nodum-core` for reuse. Scoped to file-level reachability only — the graph has no call/reference edges yet, so symbol-level (unused function/class) detection isn't feasible today.
