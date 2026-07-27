import { describe, it, expect } from "vitest";
import parser from "./kotlin.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".kt", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("KotlinParser imports", () => {
  it("extracts a fully-qualified class import", () => {
    const { imports } = parser.parse(fileInfo("a.kt", `import com.example.Foo\n`));
    expect(imports).toEqual(["com.example.Foo"]);
  });

  it("extracts a wildcard import with the suffix intact", () => {
    const { imports } = parser.parse(fileInfo("a.kt", `import com.example.*\n`));
    expect(imports).toEqual(["com.example.*"]);
  });

  it("extracts multiple imports", () => {
    const { imports } = parser.parse(
      fileInfo("a.kt", `import com.example.Foo\nimport com.other.Bar\n`),
    );
    expect(imports).toEqual(["com.example.Foo", "com.other.Bar"]);
  });

  it("returns an empty array when there are no imports", () => {
    const { imports } = parser.parse(fileInfo("a.kt", `class Foo {}\n`));
    expect(imports).toEqual([]);
  });
});
