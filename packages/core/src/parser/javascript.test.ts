import { describe, it, expect } from "vitest";
import parser from "./javascript.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".js", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("JavaScriptParser imports", () => {
  it("extracts an ESM import specifier", () => {
    const { imports } = parser.parse(fileInfo("a.js", `import { foo } from './foo';\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("extracts a real CommonJS require() call expression", () => {
    const { imports } = parser.parse(fileInfo("a.js", `const foo = require('./foo');\n`));
    expect(imports).toEqual(["./foo"]);
  });

  it("extracts an indented/mid-expression require() call", () => {
    const { imports } = parser.parse(
      fileInfo("a.js", `function load() {\n  return require('./lazy');\n}\n`),
    );
    expect(imports).toEqual(["./lazy"]);
  });

  it("deduplicates repeated imports of the same specifier", () => {
    const { imports } = parser.parse(
      fileInfo("a.js", `import './foo';\nconst x = require('./foo');\n`),
    );
    expect(imports).toEqual(["./foo"]);
  });

  it("returns an empty array when there are no imports", () => {
    const { imports } = parser.parse(fileInfo("a.js", `module.exports = {};\n`));
    expect(imports).toEqual([]);
  });
});
