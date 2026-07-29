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

  it("appends the original error's real stack onto the wrapped error's own stack — not just .cause", async () => {
    const original = new Error("stack overflow somewhere deep");
    original.stack = "Error: stack overflow somewhere deep\n    at deeplyNestedRecursiveVisit (kotlin.ts:284:7)";
    coreSyncProjectMock.mockRejectedValue(original);

    const { syncProject } = await import("./sync.js");

    try {
      await syncProject("/tmp/project", "/tmp/.nodum");
      expect.unreachable("expected syncProject to throw");
    } catch (error) {
      expect((error as Error).stack).toContain("Caused by:");
      expect((error as Error).stack).toContain("deeplyNestedRecursiveVisit (kotlin.ts:284:7)");
    }
  });
});
