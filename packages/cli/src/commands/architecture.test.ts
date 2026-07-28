import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const graphWithViolation = {
  project: "proj",
  stats: { files: 2, functions: 0, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    { id: "a", label: "List.tsx", type: "file", file: "src/ui/List.tsx", group: "ui" },
    { id: "b", label: "repo.ts", type: "file", file: "src/db/repo.ts", group: "repo" },
  ],
  edges: [{ source: "a", target: "b", relation: "imports" }],
};

function mockReadFile(config: object | null) {
  readFileMock.mockImplementation((path: string) => {
    if (path.endsWith("graph.json")) return Promise.resolve(JSON.stringify(graphWithViolation));
    if (path.endsWith(".nodumrc.json")) {
      if (config === null) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(JSON.stringify(config));
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

describe("architectureCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("reads the synced project's graph.json via the nodumDataDir convention", async () => {
    mockReadFile(null);
    const { architectureCommand } = await import("./architecture.js");
    await architectureCommand("proj", "/tmp/.nodum", {});
    expect(readFileMock).toHaveBeenCalledWith("/tmp/.nodum/proj/graph/graph.json", "utf-8");
  });

  it("prints a formatted list of violations using persisted config rules", async () => {
    mockReadFile({ architecture: { rules: [{ from: "ui", to: "repo" }] } });
    const { architectureCommand } = await import("./architecture.js");
    await architectureCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Architecture violations: 1 found");
    expect(allLogs).toContain("src/ui/List.tsx");
    expect(allLogs).toContain("src/db/repo.ts");
  });

  it("prints a clear 'none found' message when there are no rules", async () => {
    mockReadFile(null);
    const { architectureCommand } = await import("./architecture.js");
    await architectureCommand("proj", "/tmp/.nodum", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("No architecture violations found");
  });

  it("--rule merges with, rather than replaces, persisted config rules", async () => {
    mockReadFile({ architecture: { rules: [{ from: "service", to: "model" }] } }); // unrelated persisted rule
    const { architectureCommand } = await import("./architecture.js");
    await architectureCommand("proj", "/tmp/.nodum", { json: true, rule: "ui:repo" });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].rule).toEqual({ from: "ui", to: "repo" });
  });

  it("--json prints the raw ArchitectureViolation[] array", async () => {
    mockReadFile({ architecture: { rules: [{ from: "ui", to: "repo" }] } });
    const { architectureCommand } = await import("./architecture.js");
    await architectureCommand("proj", "/tmp/.nodum", { json: true });

    const parsed = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(parsed).toEqual([
      { rule: { from: "ui", to: "repo" }, sourceNodeId: "a", sourceFile: "src/ui/List.tsx", targetNodeId: "b", targetFile: "src/db/repo.ts" },
    ]);
  });

  it("throws a clear error naming the project when it hasn't been synced", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    const { architectureCommand } = await import("./architecture.js");

    await expect(architectureCommand("unsynced-proj", "/tmp/.nodum", {})).rejects.toThrow(
      'No synced graph found for "unsynced-proj"',
    );
  });
});
