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
