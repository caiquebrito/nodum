# Smart Context — Token-Efficient Graph Retrieval

## Overview

**Smart context** is how nodum avoids dumping an entire knowledge graph (hundreds+ of nodes) into
Claude's context on every query. Instead of a raw JSON graph dump, `search_graph` and related MCP
tools build a focused, relevance-ranked slice of the graph and format it as readable text.

This is not a fixed percentage — the real measured savings are reported per response (see
[Real Measurement](#real-measurement) below), not a hardcoded marketing number.

## How It Works

**File**: `packages/mcp/src/smart-context.ts`

1. **`extractKeywords()`** — pulls semantic content out of the query, dropping stop words.
2. **Conversation cache check** (`ConversationCache`, `conversation-cache.ts`) — if this query is
   related to a recent one in the same conversation, reuse its expanded node set instead of
   re-scoring from scratch (a cache hit skips work; it returns the same context a fresh search
   would find, not a separate token saving).
3. **`scoreNode()` / `findRelevantNodes()`** — ranks nodes by relevance. Scoring blends keyword
   matching with semantic (embedding-based) similarity — roughly a 60/40 semantic/keyword blend —
   with a graceful fallback to keyword-only scoring if embeddings aren't available.
4. **`expandContext()`** — expands the relevant set to connected (depth-1) neighbor nodes, bounded
   rather than unconditional (a hub node with hundreds of dependents no longer blows the context
   open — fixed as part of the v2.5.0 truth-and-measurement batch).
5. **`buildContextSections()`** — groups nodes into sections; nodes belonging to a hierarchical
   cluster (`clusterMap`) are shown as a cluster summary rather than individually, expandable on
   demand via the `expand_cluster` MCP tool.
6. **`fillSectionsToBudget()`** — when an optional `token_budget` is passed to `search_graph`,
   sections are filled greedily by relevance until the budget is spent, rather than a fixed
   `.slice(0, N)` truncation.
7. **`formatContextText()`** — renders the final selection as readable text (file → node →
   relations), not raw JSON.

`buildNodeContext()` is the equivalent path for single-node queries (`get_node`); `handleGetDeps`
does its own smart grouping by relation type.

## Real Measurement

Every `search_graph` response reports **its own measured token savings** against a full-graph-dump
baseline, computed per call via a real tokenizer (`countTokens()`), not a fixed percentage. The
hardcoded estimate figures this document used to quote (e.g. "40-60%", "83%/85%/87%") were removed
in v2.2.0's truth-and-measurement batch (specs `021`–`029`) once real per-response counting existed
— see `estimateTokenSavings()` in `smart-context.ts` and `ROADMAP.md`'s v2.5.0 entry for the full
account of that change.

Every MCP tool call is additionally logged to `~/.nodum/<project>/logs/metrics.jsonl` (timestamp,
tool, duration, approximate response tokens, success), so real-session efficiency is inspectable
directly instead of taken on faith.

## Status

All of the above — conversation caching, semantic search, hierarchical clustering, token-budgeted
filling — shipped in v2.0.0 and has been default behavior ever since; current version is v2.16.0.
There is no config flag to disable it.

## Related

- [`docs/architecture/MCP.md`](./MCP.md) — the MCP server and its 14 tools, including
  `search_graph` and `expand_cluster`
- [`docs/development/ROADMAP.md`](../development/ROADMAP.md) — v2.5.0 (real token accounting,
  bounded `expandContext`) and v2.8.0 (token-budgeted `search_graph`) entries
- `packages/mcp/src/smart-context.ts` and `packages/mcp/src/conversation-cache.ts` — source of
  truth for the current implementation
