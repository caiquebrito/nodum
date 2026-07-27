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
