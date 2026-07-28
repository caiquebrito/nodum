import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const layeredGraph = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    { id: "a", label: "List.tsx", type: "file", file: "src/ui/List.tsx", group: "ui" },
    { id: "b", label: "repo.ts", type: "file", file: "src/db/repo.ts", group: "repo" },
  ],
  edges: [{ source: "a", target: "b", relation: "imports" }],
};

function mockFiles(nodumrc: object | null) {
  readFileMock.mockImplementation((path: string) => {
    if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(layeredGraph));
    if (path.endsWith(".nodumrc.json")) {
      if (nodumrc === null) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(JSON.stringify(nodumrc));
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

describe("explainArchitectureCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints a formatted layer + dependency summary with a 'not configured' message when no rules exist", async () => {
    mockFiles(null);
    const { explainArchitectureCommand } = await import("./explain-architecture.js");
    await explainArchitectureCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("ui");
    expect(allLogs).toContain("repo");
    expect(allLogs).toContain("ui → repo  1 imports");
    expect(allLogs).toContain("none configured");
  });

  it("includes violations when a .nodumrc.json architecture rule exists", async () => {
    mockFiles({ architecture: { rules: [{ from: "ui", to: "repo" }] } });
    const { explainArchitectureCommand } = await import("./explain-architecture.js");
    await explainArchitectureCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Architecture rules: 1 configured");
    expect(allLogs).toContain("Violations: 1 found");
  });

  it("--json prints the raw ArchitectureSummary object", async () => {
    mockFiles(null);
    const { explainArchitectureCommand } = await import("./explain-architecture.js");
    await explainArchitectureCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed.violations).toBeUndefined();
    expect(parsed.layerDependencies).toEqual([{ sourceGroup: "ui", targetGroup: "repo", importCount: 1 }]);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { explainArchitectureCommand } = await import("./explain-architecture.js");

    await expect(explainArchitectureCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
