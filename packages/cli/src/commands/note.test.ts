import { describe, it, expect, vi, beforeEach } from "vitest";

const appendDecisionLogMock = vi.fn().mockResolvedValue(undefined);
const readDecisionLogMock = vi.fn().mockResolvedValue([]);
const injectLatestNoteMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@caiquebrito/nodum-core", () => ({
  appendDecisionLog: (...args: unknown[]) => appendDecisionLogMock(...args),
  readDecisionLog: (...args: unknown[]) => readDecisionLogMock(...args),
  injectLatestNote: (...args: unknown[]) => injectLatestNoteMock(...args),
}));

import { noteCommand, notesCommand } from "./note.js";

const NODUM_DATA_DIR = "/home/user/.nodum";

describe("noteCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendDecisionLogMock.mockResolvedValue(undefined);
    readDecisionLogMock.mockResolvedValue([{ timestamp: "2026-10-05 00:00", text: "a note" }]);
    injectLatestNoteMock.mockResolvedValue(undefined);
  });

  it("resolves the project name from the path's basename, matching metricsCommand's convention", async () => {
    await noteCommand("a note", "/Users/dev/code/my-project", NODUM_DATA_DIR);
    expect(appendDecisionLogMock).toHaveBeenCalledWith("/home/user/.nodum/my-project/memory", "a note");
  });

  it("injects the single latest entry into CLAUDE.md after appending", async () => {
    await noteCommand("a note", "/Users/dev/code/my-project", NODUM_DATA_DIR);
    expect(readDecisionLogMock).toHaveBeenCalledWith("/home/user/.nodum/my-project/memory", 1);
    expect(injectLatestNoteMock).toHaveBeenCalledWith(
      "/Users/dev/code/my-project",
      "/home/user/.nodum/my-project/memory",
      { timestamp: "2026-10-05 00:00", text: "a note" },
    );
  });
});

describe("notesCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to a limit of 10", async () => {
    readDecisionLogMock.mockResolvedValue([]);
    await notesCommand("/Users/dev/code/my-project", NODUM_DATA_DIR);
    expect(readDecisionLogMock).toHaveBeenCalledWith("/home/user/.nodum/my-project/memory", 10);
  });

  it("passes through an explicit --limit", async () => {
    readDecisionLogMock.mockResolvedValue([]);
    await notesCommand("/Users/dev/code/my-project", NODUM_DATA_DIR, { limit: 3 });
    expect(readDecisionLogMock).toHaveBeenCalledWith("/home/user/.nodum/my-project/memory", 3);
  });

  it("prints a friendly message when there are no notes yet", async () => {
    readDecisionLogMock.mockResolvedValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await notesCommand("/Users/dev/code/my-project", NODUM_DATA_DIR);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("No notes recorded yet");
    logSpy.mockRestore();
  });

  it("outputs JSON when --json is passed", async () => {
    const entries = [{ timestamp: "t1", text: "a" }];
    readDecisionLogMock.mockResolvedValue(entries);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await notesCommand("/Users/dev/code/my-project", NODUM_DATA_DIR, { json: true });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(entries, null, 2));
    logSpy.mockRestore();
  });
});
