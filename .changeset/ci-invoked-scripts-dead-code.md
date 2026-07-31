---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-cli": patch
"@caiquebrito/nodum-mcp": patch
---

Dead-code detection no longer flags scripts that are only ever invoked as a CI/shell subprocess (e.g. a Python script called from `bitrise.yml`/GitHub Actions/a wrapper `.sh`) as unreachable. New `findCiInvokedFiles` scans `.yml`/`.yaml`/`.sh` files for script-path tokens and resolves them against the graph, the same way `findManifestEntryFiles` already does for `AndroidManifest.xml` — wired into the CLI `dead-code` command and MCP's `suggest_refactoring`.
