import type { Graph } from "@caiquebrito/nodum-core";

/**
 * In-process cache for a project's parsed `graph.json` — some real graphs
 * are tens of MB, and before this every single MCP tool call re-read and
 * re-`JSON.parse`d the file from disk, even for two calls back-to-back in
 * the same conversation turn (spec 040).
 *
 * The primary invalidation path is explicit, not TTL-based: `handleSync`
 * calls `clearProject()` right after a fresh sync writes a new graph.json,
 * mirroring `conversation-cache.ts`'s existing `clearProject()` call at the
 * same spot. `CACHE_TTL_MS` exists only as a safety net for the case this
 * process's cache and disk drift some other way (e.g. a `nodum sync` run
 * from a separate terminal while the MCP server is still open) — not the
 * primary mechanism, so it's generous rather than tight.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches conversation-cache.ts's TTL

interface CacheEntry {
  graph: Graph;
  loadedAt: number;
}

export class GraphCache {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Returns the cached graph for `projectName` if present and not expired;
   * otherwise calls `load()`, caches the result, and returns it. `load` is
   * only ever invoked on a cache miss — callers own the actual disk I/O.
   */
  async get(projectName: string, load: () => Promise<Graph>): Promise<Graph> {
    const entry = this.cache.get(projectName);
    if (entry && Date.now() - entry.loadedAt <= CACHE_TTL_MS) {
      return entry.graph;
    }

    const graph = await load();
    this.cache.set(projectName, { graph, loadedAt: Date.now() });
    return graph;
  }

  /** Invalidates one project's cached graph — called after a fresh sync. */
  clearProject(projectName: string): void {
    this.cache.delete(projectName);
  }

  /** Invalidates every cached graph. Test-only in practice today. */
  clear(): void {
    this.cache.clear();
  }
}

/** Process-wide singleton, same export shape as `globalConversationCache`. */
export const globalGraphCache = new GraphCache();
