import { describe, it, expect } from "vitest";
import parser from "./java.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".java", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("JavaParser imports", () => {
  it("extracts a fully-qualified class import", async () => {
    const { imports } = await parser.parse(fileInfo("A.java", `import com.example.Foo;\n`));
    expect(imports).toEqual(["com.example.Foo"]);
  });

  it("extracts a wildcard import", async () => {
    const { imports } = await parser.parse(fileInfo("A.java", `import com.example.*;\n`));
    expect(imports).toEqual(["com.example.*"]);
  });

  it("skips the leading 'static' keyword on a static import", async () => {
    const { imports } = await parser.parse(fileInfo("A.java", `import static com.example.Foo.BAR;\n`));
    expect(imports).toEqual(["com.example.Foo.BAR"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("A.java", `public class A {}\n`));
    expect(imports).toEqual([]);
  });
});

describe("JavaParser method extraction", () => {
  it("does not mis-parse 'else if (...)' as a method named 'if'", async () => {
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
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    expect(nodes.map(n => n.label)).not.toContain("if");
  });
});

describe("JavaParser complexity", () => {
  it("scores a method with no decision points as 1", async () => {
    const src = "public class A {\n  public int foo() {\n    return 1;\n  }\n}\n";
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/catch/&& via brace-body extraction", async () => {
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
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    // base 1 + if + && + for + catch = 5
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });
});

describe("JavaParser duplicateHash", () => {
  const bodyOf = (varName: string, target: string) =>
    [
      `    if (${varName} > 0) {`,
      `      for (int i = 0; i < ${varName}; i++) {`,
      `        if (i % 2 == 0) {`,
      `          ${target} += i;`,
      `        }`,
      `      }`,
      `    }`,
      `    return ${target};`,
    ].join("\n");

  it("gives the same hash to renamed-but-structurally-identical methods", async () => {
    const srcA = `public class A {\n  public int foo(int x) {\n    int acc = 0;\n${bodyOf("x", "acc")}\n  }\n}`;
    const srcB = `public class B {\n  public int bar(int y) {\n    int total = 0;\n${bodyOf("y", "total")}\n  }\n}`;
    const a = (await parser.parse(fileInfo("A.java", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("B.java", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small method no duplicateHash", async () => {
    const src = "public class A {\n  public int foo() {\n    return 1;\n  }\n}\n";
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });
});
