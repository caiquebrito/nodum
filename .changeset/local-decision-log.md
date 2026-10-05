---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
"@caiquebrito/nodum-query": minor
"@caiquebrito/nodum-mcp": minor
---

New local, fully offline decision log for cheap cross-session memory (spec 082): `nodum note "<message>"` appends a timestamped entry to `<project>/memory/DECISIONS.md` (capped at the most recent 50) and surfaces only the single latest entry into the project's `CLAUDE.md`, independent of `nodum sync`'s existing sync-stats block. `nodum notes [--limit N]` reads back recent entries. Two new MCP tools, `add_note`/`get_notes`, give an agent the same round trip mid-session without shelling out to the CLI.
