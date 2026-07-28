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
  it("does not mis-parse 'else if (...)' as a method named 'if' — structurally impossible now, not just guarded against", async () => {
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

  it("extracts a constructor, previously missed entirely by the old regex", async () => {
    const src = "public class A {\n  public A(int x) {\n    this.x = x;\n  }\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("A.java", src));
    const ctor = nodes.find(n => n.label === "A" && n.type === "method");
    expect(ctor).toBeDefined();
    const classNode = nodes.find(n => n.label === "A" && n.type === "class")!;
    expect(edges).toContainEqual({ source: classNode.id, target: ctor!.id, relation: "defines" });
  });

  it("attributes a method to its class (classId->methodId), not the file", async () => {
    const src = "public class A {\n  public void foo() {}\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("A.java", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const classNode = nodes.find(n => n.label === "A" && n.type === "class")!;
    const method = nodes.find(n => n.label === "foo")!;

    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: classNode.id, target: method.id, relation: "defines" });
    expect(edges).not.toContainEqual({ source: fileNode.id, target: method.id, relation: "defines" });
  });

  it("attributes an interface's method to the interface", async () => {
    const src = "public interface A {\n  void foo();\n}\n";
    const { nodes, edges } = await parser.parse(fileInfo("A.java", src));
    const iface = nodes.find(n => n.label === "A" && n.type === "interface")!;
    const method = nodes.find(n => n.label === "foo")!;
    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: iface.id, target: method.id, relation: "defines" });
  });

  it("gives an interface method with no body no complexity/duplicateHash, without throwing", async () => {
    const { nodes } = await parser.parse(fileInfo("A.java", "public interface A {\n  void foo();\n}\n"));
    const method = nodes.find(n => n.label === "foo");
    expect(method?.complexity).toBeUndefined();
    expect(method?.duplicateHash).toBeUndefined();
  });
});

describe("JavaParser complexity", () => {
  it("scores a method with no decision points as 1", async () => {
    const src = "public class A {\n  public int foo() {\n    return 1;\n  }\n}\n";
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/catch/&& via real AST node types", async () => {
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

  it("counts a ternary — the old regex-based scorer excluded ternaries across all its languages (spec 014); tree-sitter has no reason to", async () => {
    const src = "public class A {\n  public int foo(int x) {\n    return x > 0 ? 1 : 0;\n  }\n}\n";
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    // base 1 + ternary = 2
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(2);
  });

  it("counts enhanced-for and do-while as their own distinct node types", async () => {
    const src = [
      "public class A {",
      "  public void foo(java.util.List<Integer> xs) {",
      "    for (int x : xs) {}",
      "    int i = 0;",
      "    do { i++; } while (i < 10);",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("A.java", src));
    // base 1 + enhanced-for + do-while = 3
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(3);
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
