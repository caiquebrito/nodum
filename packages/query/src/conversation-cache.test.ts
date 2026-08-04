import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConversationCache } from "./conversation-cache.js";

describe("ConversationCache", () => {
  let cache: ConversationCache;

  beforeEach(() => {
    cache = new ConversationCache();
  });

  it("returns null for a project that was never cached", () => {
    expect(cache.getRelatedContext("unknown", ["auth"])).toBeNull();
  });

  it("round-trips a cached context on a keyword-overlapping follow-up query", () => {
    const expandedIds = new Set(["auth.ts", "auth.ts__login"]);
    cache.cacheContext("proj", "auth flow", ["auth", "flow"], ["auth.ts"], expandedIds);

    const hit = cache.getRelatedContext("proj", ["auth", "flow", "login"]);
    expect(hit).not.toBeNull();
    expect(hit!.expandedIds).toBe(expandedIds);
    expect(hit!.lastQuery).toBe("auth flow");
  });

  it("misses when keyword overlap is below the 50% Jaccard threshold", () => {
    cache.cacheContext("proj", "auth flow", ["auth", "flow"], [], new Set());
    // intersection {auth} / union {auth, flow, database, migration} = 1/4 = 25%, below threshold
    const miss = cache.getRelatedContext("proj", ["auth", "database", "migration"]);
    expect(miss).toBeNull();
  });

  it("misses for a different project even with cached data elsewhere", () => {
    cache.cacheContext("proj-a", "auth flow", ["auth", "flow"], [], new Set());
    expect(cache.getRelatedContext("proj-b", ["auth", "flow"])).toBeNull();
  });

  describe("TTL expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("still hits just before the 5-minute TTL", () => {
      cache.cacheContext("proj", "auth flow", ["auth", "flow"], [], new Set());
      vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
      expect(cache.getRelatedContext("proj", ["auth", "flow"])).not.toBeNull();
    });

    it("expires once the 5-minute TTL has passed", () => {
      cache.cacheContext("proj", "auth flow", ["auth", "flow"], [], new Set());
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
      expect(cache.getRelatedContext("proj", ["auth", "flow"])).toBeNull();
    });
  });

  it("clearProject invalidates the cache immediately", () => {
    cache.cacheContext("proj", "auth flow", ["auth", "flow"], [], new Set());
    cache.clearProject("proj");
    expect(cache.getRelatedContext("proj", ["auth", "flow"])).toBeNull();
  });

  describe("cleanupExpired / getStats", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("removes only stale entries, leaving fresh ones intact", () => {
      cache.cacheContext("stale-proj", "old query", ["old"], [], new Set());
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
      cache.cacheContext("fresh-proj", "new query", ["new"], [], new Set());

      cache.cleanupExpired();

      expect(cache.getRelatedContext("fresh-proj", ["new"])).not.toBeNull();
      expect(cache.getStats().projectsCached).toBe(1);
    });

    it("getStats reflects the post-cleanup count", () => {
      cache.cacheContext("a", "q", ["q"], [], new Set());
      cache.cacheContext("b", "q", ["q"], [], new Set());
      expect(cache.getStats()).toEqual({ projectsCached: 2, totalEntries: 2 });
    });
  });

  describe("footer-shown session tracking (spec 070)", () => {
    it("reports not-shown for a project that never had markFooterShown called", () => {
      expect(cache.hasShownFullFooter("proj")).toBe(false);
    });

    it("reports shown immediately after markFooterShown", () => {
      cache.markFooterShown("proj");
      expect(cache.hasShownFullFooter("proj")).toBe(true);
    });

    it("tracks footer-shown state independently per project", () => {
      cache.markFooterShown("proj-a");
      expect(cache.hasShownFullFooter("proj-a")).toBe(true);
      expect(cache.hasShownFullFooter("proj-b")).toBe(false);
    });

    it("clearProject resets footer-shown state along with context caching", () => {
      cache.markFooterShown("proj");
      cache.clearProject("proj");
      expect(cache.hasShownFullFooter("proj")).toBe(false);
    });

    describe("TTL expiry", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("still reports shown just before the 5-minute TTL", () => {
        cache.markFooterShown("proj");
        vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
        expect(cache.hasShownFullFooter("proj")).toBe(true);
      });

      it("reports not-shown again once the 5-minute TTL has passed", () => {
        cache.markFooterShown("proj");
        vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
        expect(cache.hasShownFullFooter("proj")).toBe(false);
      });
    });
  });
});
