import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const promptsMock = vi.fn();
vi.mock("prompts", () => ({ default: (...args: unknown[]) => promptsMock(...args) }));

const syncProjectMock = vi.fn().mockResolvedValue({
  project: "proj",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [],
  edges: [],
});
vi.mock("@caiquebrito/nodum-core", () => ({
  syncProject: (...args: unknown[]) => syncProjectMock(...args),
}));

const readFileMock = vi.fn();
const writeFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

const execSyncMock = vi.fn();
vi.mock("child_process", () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

describe("initProject", () => {
  let isTTYOriginal: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    isTTYOriginal = process.stdin.isTTY;
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = isTTYOriginal as boolean;
  });

  it("fails fast without prompting when stdin is not a TTY", async () => {
    process.stdin.isTTY = false;
    const { initProject } = await import("./init.js");

    await expect(initProject("/tmp/project", "/tmp/.nodum")).rejects.toThrow("requires a terminal");
    expect(promptsMock).not.toHaveBeenCalled();
  });

  it("runSync: true calls coreSyncProject with the resolved project path", async () => {
    promptsMock.mockResolvedValue({ runSync: true, setupMcp: false });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    expect(syncProjectMock).toHaveBeenCalledWith("/tmp/project", "/tmp/.nodum");
  });

  it("runSync: false never calls coreSyncProject", async () => {
    promptsMock.mockResolvedValue({ runSync: false, setupMcp: false });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    expect(syncProjectMock).not.toHaveBeenCalled();
  });

  it("setupMcp: true with no existing .mcp.json writes a fresh one with the nodum entry", async () => {
    promptsMock.mockResolvedValue({ runSync: false, setupMcp: true });
    execSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    expect(writeFileMock).toHaveBeenCalledWith(
      "/tmp/project/.mcp.json",
      JSON.stringify({ mcpServers: { nodum: { command: "nodum-mcp" } } }, null, 2),
      "utf-8",
    );
  });

  it("setupMcp: true with an existing .mcp.json preserves other servers", async () => {
    promptsMock.mockResolvedValue({ runSync: false, setupMcp: true });
    readFileMock.mockResolvedValue(JSON.stringify({ mcpServers: { other: { command: "other-server" } } }));
    execSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    const written = JSON.parse(writeFileMock.mock.calls[0][1] as string);
    expect(written.mcpServers.other).toEqual({ command: "other-server" });
    expect(written.mcpServers.nodum).toEqual({ command: "nodum-mcp" });
  });

  it("uses absolute paths when node/nodum-mcp both resolve", async () => {
    promptsMock.mockResolvedValue({ runSync: false, setupMcp: true });
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "which node") return "/opt/homebrew/bin/node\n";
      if (cmd === "which nodum-mcp") return "/opt/homebrew/bin/nodum-mcp\n";
      throw new Error("unexpected command");
    });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    const written = JSON.parse(writeFileMock.mock.calls[0][1] as string);
    expect(written.mcpServers.nodum).toEqual({
      command: "/opt/homebrew/bin/node",
      args: ["/opt/homebrew/bin/nodum-mcp"],
    });
  });

  it("falls back to the bare command form when resolution fails", async () => {
    promptsMock.mockResolvedValue({ runSync: false, setupMcp: true });
    execSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    const { initProject } = await import("./init.js");

    await initProject("/tmp/project", "/tmp/.nodum");

    const written = JSON.parse(writeFileMock.mock.calls[0][1] as string);
    expect(written.mcpServers.nodum).toEqual({ command: "nodum-mcp" });
  });
});
