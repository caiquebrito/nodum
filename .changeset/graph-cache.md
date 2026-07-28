---
"@caiquebrito/nodum-mcp": minor
---

Adds an in-process cache for each project's parsed `graph.json`, avoiding a full disk-read + re-parse on every single MCP tool call. Some real projects' graphs are tens of MB — this previously meant re-parsing the whole file for two tool calls seconds apart in the same conversation turn.

The cache is invalidated automatically right after `sync_project` writes a fresh graph, mirroring the existing conversation-cache invalidation. A 5-minute TTL exists as a safety net for the (uncommon) case of an external `nodum sync` run from a separate terminal while the MCP server stays open.

First spec in the v2.8.0 "adaptive context budgeting" batch.
