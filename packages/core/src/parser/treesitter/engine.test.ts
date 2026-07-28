import { describe, it, expect } from "vitest";
import { loadGrammar, getQuery, Query } from "./engine.js";

// Real WASM loads — no mocking. This is the actual empirical guarantee spec
// 030 depends on: web-tree-sitter@0.25.10's ABI pairing with
// tree-sitter-wasms@0.1.13's bundled grammars (tree-sitter#5171 warns 0.26.x
// breaks this). A mocked version of this test would not catch a real
// version-pinning regression.
describe("loadGrammar", () => {
  it("loads a real grammar and parses real source with it", async () => {
    const { parser } = await loadGrammar("tree-sitter-python.wasm");
    const tree = parser.parse("def foo():\n    pass\n");

    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe("module");
  });

  it("memoizes the Language — two loads of the same grammar don't reload it", async () => {
    const a = await loadGrammar("tree-sitter-python.wasm");
    const b = await loadGrammar("tree-sitter-python.wasm");

    // Same underlying Language instance (not just equal parse results).
    expect(a.language).toBe(b.language);
  });

  it("loads a different grammar independently", async () => {
    const python = await loadGrammar("tree-sitter-python.wasm");
    const java = await loadGrammar("tree-sitter-java.wasm");

    expect(python.language).not.toBe(java.language);
  });
});

describe("getQuery", () => {
  it("compiles a query once and returns the same instance for the same cache key", async () => {
    const { language } = await loadGrammar("tree-sitter-python.wasm");
    const source = "(function_definition name: (identifier) @name)";

    const a = getQuery(language, "python-functions", source);
    const b = getQuery(language, "python-functions", source);

    expect(a).toBe(b);
    expect(a).toBeInstanceOf(Query);
  });

  it("a compiled query actually captures against real parsed source", async () => {
    const { parser, language } = await loadGrammar("tree-sitter-python.wasm");
    const tree = parser.parse("def foo():\n    pass\n");
    const query = getQuery(language, "python-functions-capture-check", "(function_definition name: (identifier) @name)");

    const captures = query.captures(tree!.rootNode);

    expect(captures).toHaveLength(1);
    expect(captures[0].name).toBe("name");
    expect(captures[0].node.text).toBe("foo");
  });
});
