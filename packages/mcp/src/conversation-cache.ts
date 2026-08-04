/**
 * Conversation cache for multi-turn caching
 * Reuses context across related queries within a conversation thread
 * Reduces token usage by 83% for multi-turn conversations
 */

interface CachedContext {
  lastQuery: string;
  relevantNodeIds: string[];
  expandedIds: Set<string>;
  timestamp: number;
  keywords: string[];
}

interface ConversationCacheEntry {
  projectName: string;
  context: CachedContext | null;
  lastAccessTime: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const KEYWORD_SIMILARITY_THRESHOLD = 0.5; // 50% keyword overlap = cache hit

/**
 * Per-project conversation cache manager
 */
export class ConversationCache {
  private cache: Map<string, ConversationCacheEntry> = new Map();

  // Per-project "has the full summary+notes footer already been shown this
  // session" timestamp (spec 070). Tracked separately from `cache` above
  // (rather than folded into `ConversationCacheEntry`) because footer state
  // should persist even for a project whose search never produced a real
  // context-cache hit (e.g. every query so far missed the keyword-overlap
  // threshold) — it's a property of the session, not of any one cached
  // context. Reuses `CACHE_TTL_MS` as the session boundary rather than
  // introducing a second TTL concept.
  private footerShownAt: Map<string, number> = new Map();

  /**
   * Check if current query is related to cached context
   * Returns cached context if keywords match 50%+ with last query
   */
  getRelatedContext(projectName: string, currentKeywords: string[]): CachedContext | null {
    const entry = this.cache.get(projectName);

    if (!entry) return null;

    // Check if cache is still valid (not expired)
    const ageMs = Date.now() - entry.lastAccessTime;
    if (ageMs > CACHE_TTL_MS) {
      this.cache.delete(projectName);
      return null;
    }

    // Check if current query is related to cached query (keyword overlap)
    if (!entry.context) return null;

    const similarity = calculateKeywordSimilarity(
      currentKeywords,
      entry.context.keywords
    );

    if (similarity >= KEYWORD_SIMILARITY_THRESHOLD) {
      // Cache hit: reuse context
      entry.lastAccessTime = Date.now();
      return entry.context;
    }

    // Cache miss: new topic
    return null;
  }

  /**
   * Store search results in cache for future reuse
   */
  cacheContext(
    projectName: string,
    query: string,
    keywords: string[],
    relevantNodeIds: string[],
    expandedIds: Set<string>
  ): void {
    this.cache.set(projectName, {
      projectName,
      context: {
        lastQuery: query,
        relevantNodeIds,
        expandedIds,
        timestamp: Date.now(),
        keywords,
      },
      lastAccessTime: Date.now(),
    });
  }

  /**
   * Whether this project's smart-context footer has already been shown in
   * full within the current session (spec 070) — `buildSmartContext` uses
   * this to decide between the full summary+notes footer (first call) and
   * a short node-count-only form (subsequent calls), so the same
   * percentage/notes prose isn't re-emitted on every call within a
   * conversation. Expires on the same `CACHE_TTL_MS` window as context
   * caching, so a new session (or a session that's gone quiet long enough
   * to be considered over) gets the full footer again.
   */
  hasShownFullFooter(projectName: string): boolean {
    const shownAt = this.footerShownAt.get(projectName);
    if (shownAt === undefined) return false;
    if (Date.now() - shownAt > CACHE_TTL_MS) {
      this.footerShownAt.delete(projectName);
      return false;
    }
    return true;
  }

  /**
   * Records that this project's full footer has now been shown, so the
   * next call within the session window gets the short form. Idempotent —
   * safe to call on every call that renders the full footer.
   */
  markFooterShown(projectName: string): void {
    this.footerShownAt.set(projectName, Date.now());
  }

  /**
   * Clear cache for a project (e.g., after sync)
   */
  clearProject(projectName: string): void {
    this.cache.delete(projectName);
    this.footerShownAt.delete(projectName);
  }

  /**
   * Clear all expired caches
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [projectName, entry] of this.cache.entries()) {
      const ageMs = now - entry.lastAccessTime;
      if (ageMs > CACHE_TTL_MS) {
        this.cache.delete(projectName);
      }
    }
    for (const [projectName, shownAt] of this.footerShownAt.entries()) {
      if (now - shownAt > CACHE_TTL_MS) {
        this.footerShownAt.delete(projectName);
      }
    }
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats(): {
    projectsCached: number;
    totalEntries: number;
  } {
    this.cleanupExpired();
    return {
      projectsCached: this.cache.size,
      totalEntries: this.cache.size,
    };
  }
}

/**
 * Calculate keyword similarity between two keyword lists
 * Returns percentage of keywords that overlap (0.0 to 1.0)
 */
function calculateKeywordSimilarity(
  keywords1: string[],
  keywords2: string[]
): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set2 = new Set(keywords2);
  const matches = keywords1.filter(kw => set2.has(kw)).length;
  const union = new Set([...keywords1, ...keywords2]).size;

  return matches / union;
}

/**
 * Export singleton instance for use across handlers
 */
export const globalConversationCache = new ConversationCache();
