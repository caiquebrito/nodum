---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum sync --incremental` now actually skips re-reading and re-parsing files that haven't changed since the last sync, using the `graph/files.json` manifest — `discoverChangedFiles()` stat-checks every file first and only reads/hashes ones that look different, and `generateGraph()` evicts and re-parses only the changed set instead of doing a full rescan. Falls back silently to a full sync if there's no previous sync to diff against. Non-incremental `nodum sync` is unchanged.
