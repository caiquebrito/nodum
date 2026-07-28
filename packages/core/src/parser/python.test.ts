import { describe, it, expect } from "vitest";
import parser from "./python.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".py", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("PythonParser imports", () => {
  it("extracts a plain absolute import", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `import os\n`));
    expect(imports).toEqual(["os"]);
  });

  it("extracts a dotted absolute import", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `import os.path\n`));
    expect(imports).toEqual(["os.path"]);
  });

  it("extracts each name in a comma-separated bare import as its own module", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `import os, sys\n`));
    expect(imports).toEqual(["os", "sys"]);
  });

  it("extracts the underlying module for an aliased import, not the alias", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `import os.path as p\n`));
    expect(imports).toEqual(["os.path"]);
  });

  it("extracts the module once for a 'from X import a, b' statement, not once per name", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from os import path, sep\n`));
    expect(imports).toEqual(["os"]);
  });

  it("extracts the module for a parenthesized multi-name from-import", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from os import (path, sep)\n`));
    expect(imports).toEqual(["os"]);
  });

  it("extracts an aliased from-import's module", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from os import path as p\n`));
    expect(imports).toEqual(["os"]);
  });

  it("encodes a bare 'from . import x' as a single leading dot plus the imported name", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from . import sibling\n`));
    expect(imports).toEqual([".sibling"]);
  });

  it("encodes 'from .pkg import x' as dots plus the named module, once (not per imported name)", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from .pkg import thing\n`));
    expect(imports).toEqual([".pkg"]);
  });

  it("encodes 'from ..pkg import x' with two leading dots", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `from ..pkg import thing\n`));
    expect(imports).toEqual(["..pkg"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.py", `x = 1\n`));
    expect(imports).toEqual([]);
  });
});

describe("PythonParser function/class extraction", () => {
  it("extracts a top-level function with its line number", async () => {
    const { nodes } = await parser.parse(fileInfo("a.py", `def foo():\n    pass\n`));
    const foo = nodes.find(n => n.label === "foo");
    expect(foo?.type).toBe("function");
    expect(foo?.line).toBe(1);
  });

  it("extracts 'async def' the same as a regular function — the old regex parser's biggest gap", async () => {
    const { nodes } = await parser.parse(fileInfo("a.py", `async def foo():\n    pass\n`));
    expect(nodes.find(n => n.label === "foo")?.type).toBe("function");
  });

  it("extracts a decorated top-level function normally", async () => {
    const { nodes } = await parser.parse(fileInfo("a.py", `@decorator\ndef foo():\n    pass\n`));
    expect(nodes.find(n => n.label === "foo")?.type).toBe("function");
  });

  it("attributes a class's methods to the class, not the file — fixing the old shared-seenNames collision", async () => {
    const src = `class Foo:\n    def bar(self):\n        pass\n\ndef Foo():\n    pass\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.py", src));

    // Both a class "Foo" and a function "Foo" exist — the old parser's
    // single shared `seenNames` set would have silently dropped one.
    expect(nodes.filter(n => n.label === "Foo")).toHaveLength(2);
    expect(nodes.find(n => n.label === "Foo" && n.type === "class")).toBeDefined();
    expect(nodes.find(n => n.label === "Foo" && n.type === "function")).toBeDefined();

    const method = nodes.find(n => n.label === "bar");
    expect(method?.type).toBe("method");
    const classId = nodes.find(n => n.label === "Foo" && n.type === "class")!.id;
    expect(edges).toContainEqual({ source: classId, target: method!.id, relation: "defines" });
  });

  it("attributes a decorated method to its class too", async () => {
    const src = `class Foo:\n    @property\n    def bar(self):\n        return 1\n`;
    const { nodes } = await parser.parse(fileInfo("a.py", src));
    expect(nodes.find(n => n.label === "bar")?.type).toBe("method");
  });

  it("does not attribute a nested (closure) function to the enclosing class", async () => {
    const src = `class Foo:\n    def bar(self):\n        def inner():\n            pass\n        return inner\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.py", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const inner = nodes.find(n => n.label === "inner");
    expect(inner?.type).toBe("function");
    expect(edges).toContainEqual({ source: fileNode.id, target: inner!.id, relation: "defines" });
  });
});

describe("PythonParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.py", `def foo():\n    return 1\n`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/and/ternary as decision points, including the ternary the old regex parser never had", async () => {
    const src = [
      "def foo(x):",
      "    if x > 0 and x < 10:",
      "        for i in range(x):",
      "            pass",
      "    return x if x else 0",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.py", src));
    // base 1 + if + and + for + ternary = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });

  it("does not double-count a nested function's branches into the parent", async () => {
    const src = [
      "def outer():",
      "    if True:",
      "        pass",
      "    def inner():",
      "        if True:",
      "            pass",
      "        if True:",
      "            pass",
      "    return inner",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.py", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + its own if
    expect(nodes.find(n => n.label === "inner")?.complexity).toBe(3); // base 1 + its own 2 ifs
  });

  it("scores a class method", async () => {
    const src = "class Foo:\n    def bar(self, x):\n        if x > 0:\n            return 1\n        return 0\n";
    const { nodes } = await parser.parse(fileInfo("a.py", src));
    expect(nodes.find(n => n.label === "bar")?.complexity).toBe(2);
  });
});

describe("PythonParser duplicateHash", () => {
  const bodyOf = (varName: string, target: string) =>
    [
      `    if ${varName} > 0:`,
      `        for i in range(${varName}):`,
      `            if i % 2 == 0:`,
      `                ${target} += i`,
      `    return ${target}`,
    ].join("\n");

  it("gives the same hash to renamed-but-structurally-identical functions", async () => {
    const srcA = `def foo(x):\n    acc = 0\n${bodyOf("x", "acc")}\n`;
    const srcB = `def bar(y):\n    total = 0\n${bodyOf("y", "total")}\n`;
    const a = (await parser.parse(fileInfo("a.py", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.py", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.py", `def foo():\n    return 1\n`));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });

  it("does not merge a nested function's own tokens into the parent's hash", async () => {
    const srcA = `def outer(x):\n    acc = 0\n${bodyOf("x", "acc")}\n    def inner():\n        return 1\n`;
    const srcB = `def outer(x):\n    acc = 0\n${bodyOf("x", "acc")}\n    def inner():\n        if x:\n            return 1\n        return 2\n`;
    const a = (await parser.parse(fileInfo("a.py", srcA))).nodes.find(n => n.label === "outer");
    const b = (await parser.parse(fileInfo("b.py", srcB))).nodes.find(n => n.label === "outer");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });
});
