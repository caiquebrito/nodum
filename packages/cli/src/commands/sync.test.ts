import { describe, it, expect, vi, beforeEach } from "vitest";

const coreSyncProjectMock = vi.fn();

vi.mock("@caiquebrito/nodum-core", () => ({
  syncProject: (...args: unknown[]) => coreSyncProjectMock(...args),
}));

describe("cli syncProject wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints a summary built from the graph returned by core", async () => {
    coreSyncProjectMock.mockResolvedValue({
      project: "sample-project",
      stats: { files: 3, functions: 5, classes: 1, interfaces: 0, edges: 4 },
      nodes: [],
      edges: [],
    });

    const { syncProject } = await import("./sync.js");
    await syncProject("/tmp/project", "/tmp/.nodum");

    const logged = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(logged).toContain("Synced: sample-project");
    expect(logged).toContain("3 files");
    expect(logged).toContain("5 functions");
  });

  it("wraps a core failure and preserves the original error via cause", async () => {
    const original = new Error("disk full");
    coreSyncProjectMock.mockRejectedValue(original);

    const { syncProject } = await import("./sync.js");

    await expect(syncProject("/tmp/project", "/tmp/.nodum")).rejects.toMatchObject({
      message: expect.stringContaining("Failed to sync project: disk full"),
      cause: original,
    });
  });
});
