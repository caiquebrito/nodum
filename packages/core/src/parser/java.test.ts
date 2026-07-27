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

describe("JavaParser method extraction", () => {
  it("does not mis-parse 'else if (...)' as a method named 'if'", () => {
    const src = [
      "public class A {",
      "  public int foo(int x) {",
      "    if (x > 0) {",
      "      return 1;",
      "    } else if (x < 0) {",
      "      return -1;",
      "    }",
      "    return 0;",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = parser.parse(fileInfo("A.java", src));
    expect(nodes.map(n => n.label)).not.toContain("if");
  });
});

describe("JavaParser complexity", () => {
  it("scores a method with no decision points as 1", () => {
    const src = "public class A {\n  public int foo() {\n    return 1;\n  }\n}\n";
    const { nodes } = parser.parse(fileInfo("A.java", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/catch/&& via brace-body extraction", () => {
    const src = [
      "public class A {",
      "  public int foo(int x) {",
      "    try {",
      "      if (x > 0 && x < 10) {",
      "        for (int i = 0; i < x; i++) {}",
      "      }",
      "    } catch (Exception e) {}",
      "    return x;",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = parser.parse(fileInfo("A.java", src));
    // base 1 + if + && + for + catch = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });
});
