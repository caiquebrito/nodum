import { describe, it, expect } from "vitest";
import type { Graph, Node } from "@caiquebrito/nodum-core";
import { SymbolKind } from "vscode-languageserver/node";
import {
  findNodeAtPosition,
  nodeLine,
  nodeRange,
  nodeUri,
  pathToUri,
  relativeFilePath,
  symbolKindForNode,
  uriToPath,
} from "./graph-utils.js";

const ROOT = "/home/dev/my-project";

function makeNode(overrides: Partial<Node>): Node {
  return {
    id: "n1",
    label: "doStuff",
    type: "function",
    file: "src/a.ts",
    group: "other",
    ...overrides,
  };
}

describe("pathToUri / uriToPath", () => {
  it("round-trips an absolute path through a file:// URI", () => {
    const uri = pathToUri("/home/dev/my-project/src/a.ts");
    expect(uri).toBe("file:///home/dev/my-project/src/a.ts");
    expect(uriToPath(uri)).toBe("/home/dev/my-project/src/a.ts");
  });
});

describe("nodeUri", () => {
  it("joins the project root with the node's project-relative file", () => {
    const node = makeNode({ file: "src/a.ts" });
    expect(nodeUri(ROOT, node)).toBe(`file://${ROOT}/src/a.ts`);
  });
});

describe("relativeFilePath", () => {
  it("is the inverse of nodeUri's join, using forward slashes", () => {
    const uri = `file://${ROOT}/src/nested/b.ts`;
    expect(relativeFilePath(ROOT, uri)).toBe("src/nested/b.ts");
  });
});

describe("nodeRange / nodeLine", () => {
  it("converts a 1-indexed node.line to a 0-indexed LSP range", () => {
    const node = makeNode({ line: 10 });
    expect(nodeLine(node)).toBe(9);
    const range = nodeRange(node);
    expect(range.start).toEqual({ line: 9, character: 0 });
    expect(range.end.line).toBe(9);
  });

  it("defaults a node with no known line to line 0, not a negative or undefined line", () => {
    const node = makeNode({ line: undefined });
    expect(nodeLine(node)).toBe(0);
  });

  it("clamps line 1 (not 0) to line 0, never negative", () => {
    const node = makeNode({ line: 1 });
    expect(nodeLine(node)).toBe(0);
  });
});

describe("symbolKindForNode", () => {
  it("maps every NodeType to a SymbolKind, including the two with no direct LSP equivalent", () => {
    expect(symbolKindForNode(makeNode({ type: "function" }))).toBe(SymbolKind.Function);
    expect(symbolKindForNode(makeNode({ type: "class" }))).toBe(SymbolKind.Class);
    expect(symbolKindForNode(makeNode({ type: "interface" }))).toBe(SymbolKind.Interface);
    expect(symbolKindForNode(makeNode({ type: "method" }))).toBe(SymbolKind.Method);
    expect(symbolKindForNode(makeNode({ type: "struct" }))).toBe(SymbolKind.Struct);
    expect(symbolKindForNode(makeNode({ type: "enum" }))).toBe(SymbolKind.Enum);
    expect(symbolKindForNode(makeNode({ type: "file" }))).toBe(SymbolKind.File);
    // No direct LSP kind exists for these two Swift/ObjC-only NodeTypes (spec 036).
    expect(symbolKindForNode(makeNode({ type: "protocol" }))).toBe(SymbolKind.Interface);
    expect(symbolKindForNode(makeNode({ type: "extension" }))).toBe(SymbolKind.Namespace);
  });
});

describe("findNodeAtPosition", () => {
  const graph: Graph = {
    project: "proj",
    stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 0 },
    nodes: [
      makeNode({ id: "file", type: "file", file: "src/a.ts", line: undefined }),
      makeNode({ id: "top", label: "topFn", type: "function", file: "src/a.ts", line: 3 }),
      makeNode({ id: "mid", label: "midFn", type: "function", file: "src/a.ts", line: 10 }),
      makeNode({ id: "other-file", label: "otherFn", type: "function", file: "src/b.ts", line: 3 }),
    ],
    edges: [],
  };

  it("picks the nearest node at or before the given 0-indexed position", () => {
    // position.line 9 (0-indexed) = source line 10 -> exactly "mid"'s line
    expect(findNodeAtPosition(graph, "src/a.ts", { line: 9, character: 0 })?.id).toBe("mid");
    // position.line 5 is between top (line 3 -> 0-idx 2) and mid (line 10 -> 0-idx 9)
    expect(findNodeAtPosition(graph, "src/a.ts", { line: 5, character: 0 })?.id).toBe("top");
  });

  it("falls back to the file node when the position is before every declaration", () => {
    expect(findNodeAtPosition(graph, "src/a.ts", { line: 0, character: 0 })?.id).toBe("file");
  });

  it("never returns a node from a different file", () => {
    const result = findNodeAtPosition(graph, "src/a.ts", { line: 100, character: 0 });
    expect(result?.file).toBe("src/a.ts");
  });
});
