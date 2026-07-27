import { describe, it, expect } from "vitest";
import parser from "./typescript.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: path.endsWith(".tsx") ? ".tsx" : ".ts", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("TypeScriptParser imports", () => {
  it("extracts a default/named import specifier", () => {
    const { imports } = parser.parse(fileInfo("a.ts", `import { foo } from './foo';\nimport bar from '../bar';\n`));
    expect(imports).toEqual(["./foo", "../bar"]);
  });

  it("extracts a bare package specifier", () => {
    const { imports } = parser.parse(fileInfo("a.ts", `import React from 'react';\n`));
    expect(imports).toEqual(["react"]);
  });

  it("extracts an import= external module reference", () => {
    const { imports } = parser.parse(fileInfo("a.ts", `import foo = require('./foo');\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("returns an empty array when there are no imports", () => {
    const { imports } = parser.parse(fileInfo("a.ts", `export const x = 1;\n`));
    expect(imports).toEqual([]);
  });
});

describe("TypeScriptParser complexity", () => {
  it("scores a function with no decision points as 1", () => {
    const { nodes } = parser.parse(fileInfo("a.ts", `function foo() { return 1; }`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/ternary/&& as decision points", () => {
    const src = `
      function foo(x: number) {
        if (x > 0) {
          for (let i = 0; i < x; i++) {}
        }
        return x > 0 && x < 10 ? 1 : 2;
      }
    `;
    const { nodes } = parser.parse(fileInfo("a.ts", src));
    // base 1 + if + for + && + ternary = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });

  it("does not double-count a nested named function's branches into the parent", () => {
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
    const { nodes } = parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + its own if
    expect(nodes.find(n => n.label === "inner")?.complexity).toBe(3); // base 1 + its own 2 ifs
  });

  it("does count a nested arrow-function callback's branches into the enclosing scored function", () => {
    const src = `
      function outer(items: number[]) {
        return items.map(x => x > 0 ? x : -x);
      }
    `;
    const { nodes } = parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + arrow's ternary
  });

  it("scores a class method", () => {
    const src = `
      class Foo {
        bar(x: number) {
          if (x > 0) { return 1; }
          return 0;
        }
      }
    `;
    const { nodes } = parser.parse(fileInfo("a.ts", src));
    expect(nodes.find(n => n.label === "bar")?.complexity).toBe(2);
  });
});
