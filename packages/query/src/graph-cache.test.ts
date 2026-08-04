import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphCache } from "./graph-cache.js";
import type { Graph } from "@caiquebrito/nodum-core";

function fakeGraph(project: string): Graph {
  return {
    project,
    stats: { files: 0, functions: 0, classes: 0, interfaces: 0, edges: 0 },
    nodes: [],
    edges: [],
  };
}

describe("GraphCache", () => {
  let cache: GraphCache;

  beforeEach(() => {
    cache = new GraphCache();
  });

  it("calls the loader on a cache miss and returns its result", async () => {
    const load = vi.fn().mockResolvedValue(fakeGraph("proj"));
    const graph = await cache.get("proj", load);
    expect(graph.project).toBe("proj");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not call the loader again on a cache hit", async () => {
    const load = vi.fn().mockResolvedValue(fakeGraph("proj"));
    await cache.get("proj", load);
    await cache.get("proj", load);
    await cache.get("proj", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches each project independently", async () => {
    const loadA = vi.fn().mockResolvedValue(fakeGraph("a"));
    const loadB = vi.fn().mockResolvedValue(fakeGraph("b"));
    await cache.get("a", loadA);
    await cache.get("a", loadA);
    await cache.get("b", loadB);
    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the loader after clearProject() for that project only", async () => {
    const loadA = vi.fn().mockResolvedValue(fakeGraph("a"));
    const loadB = vi.fn().mockResolvedValue(fakeGraph("b"));
    await cache.get("a", loadA);
    await cache.get("b", loadB);

    cache.clearProject("a");

    await cache.get("a", loadA);
    await cache.get("b", loadB);
    expect(loadA).toHaveBeenCalledTimes(2);
    expect(loadB).toHaveBeenCalledTimes(1); // untouched by clearing "a"
  });

  it("re-invokes the loader for every project after clear()", async () => {
    const loadA = vi.fn().mockResolvedValue(fakeGraph("a"));
    const loadB = vi.fn().mockResolvedValue(fakeGraph("b"));
    await cache.get("a", loadA);
    await cache.get("b", loadB);

    cache.clear();

    await cache.get("a", loadA);
    await cache.get("b", loadB);
    expect(loadA).toHaveBeenCalledTimes(2);
    expect(loadB).toHaveBeenCalledTimes(2);
  });

  it("re-invokes the loader once the TTL has expired", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValue(fakeGraph("proj"));
      await cache.get("proj", load);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // just past the 5-minute TTL

      await cache.get("proj", load);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the freshly loaded graph itself, not a stale reference, right after clearProject()", async () => {
    let call = 0;
    const load = vi.fn().mockImplementation(async () => {
      call++;
      return fakeGraph(`proj-v${call}`);
    });

    const first = await cache.get("proj", load);
    expect(first.project).toBe("proj-v1");

    cache.clearProject("proj");

    const second = await cache.get("proj", load);
    expect(second.project).toBe("proj-v2");
  });
});
