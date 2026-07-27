import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

class FakeWatcher extends EventEmitter {
  close = vi.fn().mockResolvedValue(undefined);
}

let lastWatcher: FakeWatcher;
let lastIgnored: ((path: string) => boolean) | undefined;
const chokidarWatchMock = vi.fn((_path: string, options: any) => {
  lastIgnored = options.ignored;
  lastWatcher = new FakeWatcher();
  return lastWatcher;
});

vi.mock("chokidar", () => ({
  default: { watch: (...args: unknown[]) => chokidarWatchMock(...(args as [string, any])) },
}));

const syncProjectMock = vi.fn().mockResolvedValue({
  project: "proj",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [],
  edges: [],
});
const loadScanConfigMock = vi.fn().mockResolvedValue({});
const isExcludedMock = vi.fn().mockReturnValue(false);
const buildFileMatcherMock = vi.fn().mockResolvedValue({ isExcluded: isExcludedMock, isIncluded: () => true });

vi.mock("@caiquebrito/nodum-core", () => ({
  syncProject: (...args: unknown[]) => syncProjectMock(...args),
  loadScanConfig: (...args: unknown[]) => loadScanConfigMock(...args),
  buildFileMatcher: (...args: unknown[]) => buildFileMatcherMock(...args),
  IGNORED_DIRS: new Set(["node_modules", ".git"]),
}));

describe("watchProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    isExcludedMock.mockReturnValue(false);
    process.removeAllListeners("SIGINT");
  });

  afterEach(() => {
    process.removeAllListeners("SIGINT");
    vi.useRealTimers();
  });

  it("runs an initial sync immediately on startup", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum");

    expect(syncProjectMock).toHaveBeenCalledTimes(1);
    expect(syncProjectMock).toHaveBeenCalledWith("/tmp/project", "/tmp/.nodum", { incremental: true });
  });

  it("a file change triggers a sync after the debounce window", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum", { debounceMs: 500 });
    syncProjectMock.mockClear();

    lastWatcher.emit("change", "/tmp/project/a.ts");
    expect(syncProjectMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(syncProjectMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid successive changes into exactly one sync", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum", { debounceMs: 500 });
    syncProjectMock.mockClear();

    lastWatcher.emit("change", "/tmp/project/a.ts");
    await vi.advanceTimersByTimeAsync(100);
    lastWatcher.emit("change", "/tmp/project/b.ts");
    await vi.advanceTimersByTimeAsync(100);
    lastWatcher.emit("add", "/tmp/project/c.ts");
    await vi.advanceTimersByTimeAsync(100);
    lastWatcher.emit("unlink", "/tmp/project/d.ts");

    await vi.advanceTimersByTimeAsync(500);
    expect(syncProjectMock).toHaveBeenCalledTimes(1);
  });

  it("--debounce changes the wait window", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum", { debounceMs: 2000 });
    syncProjectMock.mockClear();

    lastWatcher.emit("change", "/tmp/project/a.ts");
    await vi.advanceTimersByTimeAsync(1000);
    expect(syncProjectMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(syncProjectMock).toHaveBeenCalledTimes(1);
  });

  it("ignores CLAUDE.md at the project root — regression test for an infinite self-triggering sync loop", async () => {
    // Every triggered sync rewrites CLAUDE.md (injectCLAUDEContext) with a
    // fresh timestamp. Without excluding it, watching it would schedule
    // another sync on every completed sync, forever — this was caught via
    // real end-to-end testing (a sync fired every ~400ms with zero edits).
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum");

    expect(lastIgnored!("/tmp/project/CLAUDE.md")).toBe(true);
    expect(isExcludedMock).not.toHaveBeenCalled();
  });

  it("the ignored function rejects paths under a coarse IGNORED_DIRS entry without consulting the matcher", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum");

    expect(lastIgnored!("/tmp/project/node_modules/pkg/index.js")).toBe(true);
    expect(isExcludedMock).not.toHaveBeenCalled();
  });

  it("the ignored function delegates to matcher.isExcluded for paths not caught by the coarse check", async () => {
    isExcludedMock.mockReturnValue(true);
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum");

    const result = lastIgnored!("/tmp/project/vendor/lib.ts");
    expect(result).toBe(true);
    expect(isExcludedMock).toHaveBeenCalledWith("vendor/lib.ts");
  });

  it("tests both the plain and trailing-slash form of a path — chokidar's own stats delivery isn't reliable enough to tell files from directories", async () => {
    // Only the trailing-slash form matches (a directory-only gitignore rule).
    isExcludedMock.mockImplementation((p: string) => p === "some-dir/");
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum");

    expect(lastIgnored!("/tmp/project/some-dir")).toBe(true);
    expect(isExcludedMock).toHaveBeenCalledWith("some-dir");
    expect(isExcludedMock).toHaveBeenCalledWith("some-dir/");
  });

  it("a sync failure is caught and logged without crashing or closing the watcher", async () => {
    const { watchProject } = await import("./watch.js");
    await watchProject("/tmp/project", "/tmp/.nodum", { debounceMs: 500 });
    syncProjectMock.mockClear();
    syncProjectMock.mockRejectedValueOnce(new Error("parse blew up"));

    lastWatcher.emit("change", "/tmp/project/a.ts");
    await vi.advanceTimersByTimeAsync(500);

    expect(console.error).toHaveBeenCalledWith("❌ Sync failed:", "parse blew up");
    expect(lastWatcher.close).not.toHaveBeenCalled();
  });

  it("SIGINT closes the watcher", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const { watchProject } = await import("./watch.js");
      await watchProject("/tmp/project", "/tmp/.nodum");

      process.emit("SIGINT");
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());

      expect(lastWatcher.close).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
