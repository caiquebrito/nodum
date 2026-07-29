import { describe, it, expect } from "vitest";
import parser from "./typescript.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: path.endsWith(".tsx") ? ".tsx" : ".ts", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("TypeScriptParser imports", () => {
  it("extracts a default/named import specifier", async () => {
    const { imports } = await parser.parse(fileInfo("a.ts", `import { foo } from './foo';\nimport bar from '../bar';\n`));
    expect(imports).toEqual(["./foo", "../bar"]);
  });

  it("extracts a bare package specifier", async () => {
    const { imports } = await parser.parse(fileInfo("a.ts", `import React from 'react';\n`));
    expect(imports).toEqual(["react"]);
  });

  it("extracts an import= external module reference", async () => {
    const { imports } = await parser.parse(fileInfo("a.ts", `import foo = require('./foo');\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.ts", `export const x = 1;\n`));
    expect(imports).toEqual([]);
  });
});

describe("TypeScriptParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.ts", `function foo() { return 1; }`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/ternary/&& as decision points", async () => {
    const src = `
      function foo(x: number) {
        if (x > 0) {
          for (let i = 0; i < x; i++) {}
        }
        return x > 0 && x < 10 ? 1 : 2;
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    // base 1 + if + for + && + ternary = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });

  it("does not double-count a nested named function's branches into the parent", async () => {
    const src = `
      function outer() {
        if (true) {}
        function inner() {
          if (true) {}
          if (true) {}
        }
        return inner;
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + its own if
    expect(nodes.find(n => n.label === "inner")?.complexity).toBe(3); // base 1 + its own 2 ifs
  });

  it("does count a nested arrow-function callback's branches into the enclosing scored function", async () => {
    const src = `
      function outer(items: number[]) {
        return items.map(x => x > 0 ? x : -x);
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + arrow's ternary
  });

  it("scores a class method", async () => {
    const src = `
      class Foo {
        bar(x: number) {
          if (x > 0) { return 1; }
          return 0;
        }
      }
    `;
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "bar")?.complexity).toBe(2);
  });
});

describe("TypeScriptParser duplicateHash", () => {
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
    const srcA = `function foo(x: number) { let acc = 0; ${bodyOf("x", "acc")} }`;
    const srcB = `function bar(y: number) { let total = 0; ${bodyOf("y", "total")} }`;
    const a = (await parser.parse(fileInfo("a.ts", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.ts", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.ts", `function foo() { return 1; }`));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });

  it("does not merge a nested named function's own tokens into the parent's hash", async () => {
    // Both outers have a nested `inner` declaration (so the boundary token
    // itself is present in both streams equally) — only inner's internal
    // content differs. If inner's tokens leaked into outer's stream, these
    // two outer hashes would differ; they must not.
    const srcA = `
      function outer(x: number) {
        let acc = 0;
        ${bodyOf("x", "acc")}
        function inner() { return 1; }
      }
    `;
    const srcB = `
      function outer(x: number) {
        let acc = 0;
        ${bodyOf("x", "acc")}
        function inner() {
          if (x) { for (let i = 0; i < 10; i++) { acc += i; } }
          return acc;
        }
      }
    `;
    const a = (await parser.parse(fileInfo("a.ts", srcA))).nodes.find(n => n.label === "outer");
    const b = (await parser.parse(fileInfo("b.ts", srcB))).nodes.find(n => n.label === "outer");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });
});

describe("TypeScriptParser calls edges", () => {
  it("emits a calls edge for a bare-identifier call to a same-file function", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.ts", src));
    const a = nodes.find(n => n.label === "a")!;
    const b = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: a.id, target: b.id, relation: "calls" });
  });

  it("does not emit a calls edge for a qualified this.x() call", async () => {
    const src = `
      class Foo {
        bar() { return this.baz(); }
        baz() { return 1; }
      }
    `;
    const { nodes, edges } = await parser.parse(fileInfo("a.ts", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz")!;
    expect(edges).not.toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("does not emit a calls edge to an unresolvable name", async () => {
    const { nodes, edges } = await parser.parse(fileInfo("a.ts", `function a() { return unknownFn(); }\n`));
    const a = nodes.find(n => n.label === "a")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === a.id)).toHaveLength(0);
  });

  it("emits a self-recursive calls edge", async () => {
    const { nodes, edges } = await parser.parse(fileInfo("a.ts", `function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }\n`));
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
    const { nodes, edges } = await parser.parse(fileInfo("a.ts", src));
    const outer = nodes.find(n => n.label === "outer")!;
    const inner = nodes.find(n => n.label === "inner")!;
    const target = nodes.find(n => n.label === "target")!;
    expect(edges).toContainEqual({ source: inner.id, target: target.id, relation: "calls" });
    expect(edges).not.toContainEqual({ source: outer.id, target: target.id, relation: "calls" });
  });
});

describe("TypeScriptParser cognitive complexity (spec 045)", () => {
  it("scores a function with no decision points as 0", async () => {
    const { nodes } = await parser.parse(fileInfo("a.ts", "function f() { return 1; }\n"));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(0);
  });

  it("gives nested ifs a higher cognitive score than sequential ifs, unlike cyclomatic", async () => {
    const seq = "function seq(x) { if (x == 1) {} if (x == 2) {} if (x == 3) {} }\n";
    const nested = "function nested(x) { if (x == 1) { if (x == 2) { if (x == 3) {} } } }\n";
    const seqNode = (await parser.parse(fileInfo("a.ts", seq))).nodes.find(n => n.label === "seq");
    const nestedNode = (await parser.parse(fileInfo("b.ts", nested))).nodes.find(n => n.label === "nested");
    expect(seqNode?.complexity).toBe(nestedNode?.complexity);
    expect(seqNode?.cognitiveComplexity).toBe(3);
    expect(nestedNode?.cognitiveComplexity).toBe(6);
  });

  it("collapses a boolean-operator chain to +1", async () => {
    const src = "function f(a, b, c) { if (a && b && c) {} }\n";
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(2);
  });

  it("scores a self-recursive call as +1", async () => {
    const src = "function fact(n) { if (n <= 1) { return 1; } return fact(n - 1) + n; }\n";
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "fact")?.cognitiveComplexity).toBe(2);
  });

  it("rolls an arrow function's branches into the enclosing function, at one deeper nesting level", async () => {
    const src = "function outer() { const fn = () => { if (true) {} }; fn(); }\n";
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "outer")?.cognitiveComplexity).toBe(2);
  });

  it("scores a class method's cognitive complexity", async () => {
    const src = "class Foo { bar(x) { if (x) { if (x) {} } } }\n";
    const { nodes } = await parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "bar")?.cognitiveComplexity).toBe(3);
  });
});
