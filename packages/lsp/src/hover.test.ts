import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Graph } from "@caiquebrito/nodum-core";
import { MarkupKind } from "vscode-languageserver/node";

const { handleGetNodeMock } = vi.hoisted(() => ({ handleGetNodeMock: vi.fn() }));
vi.mock("@caiquebrito/nodum-query", () => ({ handleGetNode: handleGetNodeMock }));

const { hoverAt } = await import("./hover.js");

const ROOT = "/proj";

const graph: Graph = {
  project: "proj",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "file", label: "a.ts", type: "file", file: "a.ts", group: "other" },
    { id: "fn", label: "doStuff", type: "function", file: "a.ts", group: "other", line: 5 },
  ],
  edges: [],
};

describe("hoverAt", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("resolves the node at the position and hands its id to handleGetNode", async () => {
    handleGetNodeMock.mockResolvedValue({ content: [{ type: "text", text: "📍 doStuff\n   Type: function" }] });

    const hover = await hoverAt("proj", ROOT, graph, `file://${ROOT}/a.ts`, { line: 4, character: 0 });

    expect(handleGetNodeMock).toHaveBeenCalledWith("proj", "fn");
    expect(hover?.contents).toEqual({ kind: MarkupKind.PlainText, value: "📍 doStuff\n   Type: function" });
    expect(hover?.range?.start.line).toBe(4);
  });

  it("returns null when no node exists for that document at all", async () => {
    const hover = await hoverAt("proj", ROOT, graph, `file://${ROOT}/missing.ts`, { line: 0, character: 0 });
    expect(hover).toBeNull();
    expect(handleGetNodeMock).not.toHaveBeenCalled();
  });
});
