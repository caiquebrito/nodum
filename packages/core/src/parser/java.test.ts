import { describe, it, expect } from "vitest";
import parser from "./java.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".java", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("JavaParser imports", () => {
  it("extracts a fully-qualified class import", () => {
    const { imports } = parser.parse(fileInfo("A.java", `import com.example.Foo;\n`));
    expect(imports).toEqual(["com.example.Foo"]);
  });

  it("extracts a wildcard import", () => {
    const { imports } = parser.parse(fileInfo("A.java", `import com.example.*;\n`));
    expect(imports).toEqual(["com.example.*"]);
  });

  it("skips the leading 'static' keyword on a static import", () => {
    const { imports } = parser.parse(fileInfo("A.java", `import static com.example.Foo.BAR;\n`));
    expect(imports).toEqual(["com.example.Foo.BAR"]);
  });

  it("returns an empty array when there are no imports", () => {
    const { imports } = parser.parse(fileInfo("A.java", `public class A {}\n`));
    expect(imports).toEqual([]);
  });
});
