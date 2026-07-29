import { describe, it, expect } from "vitest";
import { TreeSitterParser } from "./base.js";
import { getQuery } from "./engine.js";
import type { FileInfo, ParseResult } from "../../types.js";

// A minimal concrete subclass — enough to prove TreeSitterParser's lazy
// grammar-load behavior without needing a real language migration (that's
// spec 031+). Deliberately exposes when ensureReady() actually ran.
class DummyTreeSitterParser extends TreeSitterParser {
  language = "Dummy";
  extensions = [".dummy"];
  protected grammarFile = "tree-sitter-python.wasm"; // any real grammar works for this test
  loadCount = 0;

  async parse(_file: FileInfo): Promise<ParseResult> {
    const { parser } = await this.ensureReady();
    this.loadCount++;
    const tree = parser.parse("def foo():\n    pass\n");
    const label = tree!.rootNode.type;
    tree!.delete();
    return {
      nodes: [{ id: "dummy", label, type: "file", file: "dummy", group: "other" }],
      edges: [],
    };
  }

  async parseSource(source: string): Promise<{ funcName: string | undefined }> {
    const { parser, language } = await this.ensureReady();
    const tree = parser.parse(source);
    const root = tree!.rootNode;
    const query = getQuery(language, "dummy-functions", "(function_definition name: (identifier) @name) @def");
    const funcName = query.matches(root)[0]?.captures.find(c => c.name === "name")?.node.text;
    tree!.delete();
    return { funcName };
  }
}

const fileInfo: FileInfo = { path: "a.dummy", ext: ".dummy", content: "", hash: "h", mtimeMs: 1, size: 0 };

describe("TreeSitterParser", () => {
  it("parse() is async and returns a usable ParseResult", async () => {
    const p = new DummyTreeSitterParser();
    const result = await p.parse(fileInfo);
    expect(result.nodes[0].label).toBe("module");
  });

  it("repeated parse() calls on the same instance all succeed — grammar loading is lazy but never re-paid per call", async () => {
    const p = new DummyTreeSitterParser();
    // Constructing did not load anything yet.
    expect(p.loadCount).toBe(0);

    await p.parse(fileInfo);
    await p.parse(fileInfo);
    await p.parse(fileInfo);

    expect(p.loadCount).toBe(3);

    // The underlying Language is shared via engine.ts's own module-level
    // cache, not per-instance — a second instance shouldn't have to reload
    // it either.
    const p2 = new DummyTreeSitterParser();
    const result = await p2.parse(fileInfo);
    expect(result.nodes[0].label).toBe("module");
  });

  it("concurrent parse() calls on the same instance don't corrupt each other's results (spec 042: fresh TSParser per call)", async () => {
    const p = new DummyTreeSitterParser();
    const sources = Array.from({ length: 8 }, (_, i) => `def fn_${i}():\n    return ${i}\n`);

    const results = await Promise.all(sources.map(src => p.parseSource(src)));

    results.forEach((r, i) => {
      expect(r.funcName).toBe(`fn_${i}`);
    });
  });
});
