import { describe, it, expect } from "vitest";
import parser from "./javascript.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".js", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("JavaScriptParser imports", () => {
  it("extracts an ESM import specifier", async () => {
    const { imports } = await parser.parse(fileInfo("a.js", `import { foo } from './foo';\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("extracts a real CommonJS require() call expression", async () => {
    const { imports } = await parser.parse(fileInfo("a.js", `const foo = require('./foo');\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("extracts an indented/mid-expression require() call", async () => {
    const { imports } = await parser.parse(
      fileInfo("a.js", `function load() {\n  return require('./lazy');\n}\n`),
    );
    expect(imports).toEqual(["./lazy"]);
  });

  it("deduplicates repeated imports of the same specifier", async () => {
    const { imports } = await parser.parse(
      fileInfo("a.js", `import './foo';\nconst x = require('./foo');\n`),
    );
    expect(imports).toEqual(["./foo"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.js", `module.exports = {};\n`));
    expect(imports).toEqual([]);
  });
});

describe("JavaScriptParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.js", `function foo() { return 1; }`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/&&/|| as decision points via real AST node types", async () => {
    const src = `
      function foo(x) {
        if (x > 0 && x < 10) {
          for (let i = 0; i < x; i++) {}
        }
        return x || 0;
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    // base 1 + if + && + for + || = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });

  it("leaves a brace-less single-expression arrow function unscored", async () => {
    const src = `const foo = x => x + 1;\nconst y = 2;\nconst z = 3;\n`;
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBeUndefined();
  });

  it("counts a ternary — the old regex-based scorer excluded ternaries across all its languages (spec 014); tree-sitter has no reason to", async () => {
    const { nodes } = await parser.parse(fileInfo("a.js", `function foo(x) { return x > 0 ? 1 : 0; }`));
    // base 1 + ternary = 2
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(2);
  });

  it("counts a switch case but not the bare 'default:' label, matching the old regex's own distinction", async () => {
    const src = `
      function foo(x) {
        switch (x) {
          case 1: return "a";
          case 2: return "b";
          default: return "c";
        }
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    // base 1 + 2 cases = 3 (default: doesn't count)
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(3);
  });

  it("counts for-of/for-in and do-while as decision points", async () => {
    const src = `
      function foo(xs) {
        for (const x of xs) {}
        let i = 0;
        do { i++; } while (i < 10);
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    // base 1 + for-of + do-while = 3
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(3);
  });
});

describe("JavaScriptParser line numbers", () => {
  it("sets a line number on a function node — the old regex parser never did", async () => {
    const { nodes } = await parser.parse(fileInfo("a.js", `const x = 1;\n\nfunction foo() {}\n`));
    expect(nodes.find(n => n.label === "foo")?.line).toBe(3);
  });
});

describe("JavaScriptParser class extraction", () => {
  it("extracts a class's methods — the old regex parser extracted the class and nothing inside it", async () => {
    const src = "class Foo {\n  bar() {\n    return 1;\n  }\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("a.js", src));

    const classNode = nodes.find(n => n.label === "Foo" && n.type === "class")!;
    const method = nodes.find(n => n.label === "bar")!;
    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: classNode.id, target: method.id, relation: "defines" });
  });

  it("attributes a static method to its class the same as an instance method", async () => {
    const src = "class Foo {\n  static bar() {}\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    expect(nodes.find(n => n.label === "bar")?.type).toBe("method");
  });

  it("scores a class method's complexity", async () => {
    const src = "class Foo {\n  bar(x) {\n    if (x > 0) { return 1; }\n    return 0;\n  }\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.js", src));
    expect(nodes.find(n => n.label === "bar")?.complexity).toBe(2);
  });

  it("does not attribute a standalone named function assigned inside a method to the class", async () => {
    const src = "class Foo {\n  bar() {\n    function helper() { return 1; }\n    return helper();\n  }\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("a.js", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const helper = nodes.find(n => n.label === "helper")!;
    expect(helper.type).toBe("function");
    expect(edges).toContainEqual({ source: fileNode.id, target: helper.id, relation: "defines" });
  });
});

describe("JavaScriptParser duplicateHash", () => {
  const bodyOf = (varName: string, target: string) => `
    if (${varName} > 0) {
      for (let i = 0; i < ${varName}; i++) {
        if (i % 2 === 0) {
          ${target} += i;
        }
      }
    }
    return ${target};
  `;

  it("gives the same hash to renamed-but-structurally-identical functions", async () => {
    const srcA = `function foo(x) { let acc = 0; ${bodyOf("x", "acc")} }`;
    const srcB = `function bar(y) { let total = 0; ${bodyOf("y", "total")} }`;
    const a = (await parser.parse(fileInfo("a.js", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.js", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.js", `function foo() { return 1; }`));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });
});

describe("JavaScriptParser calls edges", () => {
  it("emits a calls edge for a bare-identifier call to a same-file function", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.js", src));
    const a = nodes.find(n => n.label === "a")!;
    const b = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: a.id, target: b.id, relation: "calls" });
  });

  it("does not emit a calls edge for a qualified this.x() call", async () => {
    const src = "class Foo {\n  bar() { return this.baz(); }\n  baz() { return 1; }\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("a.js", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz")!;
    expect(edges).not.toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("does not emit a calls edge for require(), which is never a locally-defined function", async () => {
    const { nodes, edges } = await parser.parse(fileInfo("a.js", `function a() { return require('./b'); }\n`));
    const a = nodes.find(n => n.label === "a")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === a.id)).toHaveLength(0);
  });

  it("emits a self-recursive calls edge", async () => {
    const { nodes, edges } = await parser.parse(fileInfo("a.js", `function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }\n`));
    const fact = nodes.find(n => n.label === "fact")!;
    expect(edges).toContainEqual({ source: fact.id, target: fact.id, relation: "calls" });
  });

  it("does not attribute a nested function's call to the enclosing function", async () => {
    const src = `
      function outer() {
        function inner() { return target(); }
        return inner;
      }
      function target() { return 1; }
    `;
    const { nodes, edges } = await parser.parse(fileInfo("a.js", src));
    const outer = nodes.find(n => n.label === "outer")!;
    const inner = nodes.find(n => n.label === "inner")!;
    const target = nodes.find(n => n.label === "target")!;
    expect(edges).toContainEqual({ source: inner.id, target: target.id, relation: "calls" });
    expect(edges).not.toContainEqual({ source: outer.id, target: target.id, relation: "calls" });
  });
});
