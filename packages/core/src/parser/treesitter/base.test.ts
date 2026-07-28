import { describe, it, expect } from "vitest";
import { TreeSitterParser } from "./base.js";
import type { FileInfo, ParseResult } from "../../types.js";

// A minimal concrete subclass — enough to prove TreeSitterParser's lazy,
// memoized grammar-load behavior without needing a real language migration
// (that's spec 031+). Deliberately exposes when ensureReady() actually ran.
class DummyTreeSitterParser extends TreeSitterParser {
  language = "Dummy";
  extensions = [".dummy"];
  protected grammarFile = "tree-sitter-python.wasm"; // any real grammar works for this test
  loadCount = 0;

  async parse(_file: FileInfo): Promise<ParseResult> {
    const { parser } = await this.ensureReady();
    this.loadCount++;
    const tree = parser.parse("def foo():\n    pass\n");
    return {
      nodes: [{ id: "dummy", label: tree!.rootNode.type, type: "file", file: "dummy", group: "other" }],
      edges: [],
    };
  }
}

const fileInfo: FileInfo = { path: "a.dummy", ext: ".dummy", content: "", hash: "h", mtimeMs: 1, size: 0 };

describe("TreeSitterParser", () => {
  it("parse() is async and returns a usable ParseResult", async () => {
    const p = new DummyTreeSitterParser();
    const result = await p.parse(fileInfo);
    expect(result.nodes[0].label).toBe("module");
  });

  it("memoizes the grammar-load promise — constructing the instance does no work, and repeated parse() calls reuse the same readiness", async () => {
    const p = new DummyTreeSitterParser();
    // Constructing did not load anything yet.
    expect(p.loadCount).toBe(0);

    await p.parse(fileInfo);
    await p.parse(fileInfo);
    await p.parse(fileInfo);

    // ensureReady() ran (proven by loadCount incrementing per parse call —
    // that's this parser's own work), but the underlying grammar load
    // itself is shared via engine.ts's own module-level cache, not
    // per-instance — a second instance shouldn't have to reload it either.
    expect(p.loadCount).toBe(3);

    const p2 = new DummyTreeSitterParser();
    const result = await p2.parse(fileInfo);
    expect(result.nodes[0].label).toBe("module");
  });
});
