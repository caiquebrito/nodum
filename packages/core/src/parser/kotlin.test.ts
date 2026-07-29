import { describe, it, expect } from "vitest";
import parser from "./kotlin.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".kt", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("KotlinParser imports", () => {
  it("extracts a fully-qualified class import", async () => {
    const { imports } = await parser.parse(fileInfo("a.kt", `import com.example.Foo\n`));
    expect(imports).toEqual(["com.example.Foo"]);
  });

  it("extracts a wildcard import with the suffix intact", async () => {
    const { imports } = await parser.parse(fileInfo("a.kt", `import com.example.*\n`));
    expect(imports).toEqual(["com.example.*"]);
  });

  it("extracts multiple imports", async () => {
    const { imports } = await parser.parse(
      fileInfo("a.kt", `import com.example.Foo\nimport com.other.Bar\n`),
    );
    expect(imports).toEqual(["com.example.Foo", "com.other.Bar"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.kt", `class Foo {}\n`));
    expect(imports).toEqual([]);
  });
});

describe("KotlinParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `fun foo(): Int {\n  return 1\n}\n`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/for/&&/elvis as decision points — elvis is now counted (spec 044), unlike the old regex parser", async () => {
    const src = [
      "fun foo(x: Int?): Int {",
      "  if (x != null && x > 0) {",
      "    for (i in 0..x) {}",
      "  }",
      "  return x ?: 0",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    // base 1 + if + && + for + elvis = 5. The old regex parser deliberately
    // excluded elvis as a workaround for text-matching ambiguity with a
    // nullable type's bare `?` (String?) — a concern that doesn't apply to
    // a real AST, where elvis_expression is an unambiguous node type. Now
    // counted, matching swift.ts's own nil_coalescing_expression precedent.
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5);
  });

  it("counts while/do-while/catch/||", async () => {
    const src = [
      "fun foo(x: Int): Int {",
      "  while (x > 0) {}",
      "  do {} while (x > 0)",
      "  try {",
      "  } catch (e: Exception) {",
      "  }",
      "  return x > 0 || x < 0",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(5); // base 1 + while + do-while + catch + ||
  });

  it("counts non-default when entries but not the else branch — a real capability upgrade, the old regex never matched Kotlin's when/-> syntax at all", async () => {
    const src = [
      "fun foo(x: Int): Int {",
      "  return when (x) {",
      "    1 -> 1",
      "    2 -> 2",
      "    else -> 0",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(3); // base 1 + 2 non-default entries
  });

  it("scores an expression-bodied function — the old regex parser could never extract a body for these at all", async () => {
    const src = "fun foo(x: Int): Int = if (x > 0) 1 else 0";
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(2);
  });

  it("does not double-count a nested lambda-holding local's branches when it's not itself a callable, but does roll a directly-descended lambda_literal's branches into the enclosing function", async () => {
    const src = [
      "fun foo() {",
      "  val fn = { if (true) {} }",
      "  fn()",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(2); // base 1 + the lambda's if
  });

  it("does not double-count a nested top-level function's branches into another top-level function", async () => {
    const src = [
      "fun outer() {",
      "  if (true) {}",
      "}",
      "",
      "fun inner() {",
      "  if (true) {}",
      "  if (true) {}",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2);
    expect(nodes.find(n => n.label === "inner")?.complexity).toBe(3);
  });
});

describe("KotlinParser type extraction", () => {
  it("extracts a class", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `class Foo {}\n`));
    const foo = nodes.find(n => n.label === "Foo");
    expect(foo?.type).toBe("class");
    expect(foo?.line).toBe(1);
  });

  it("extracts an interface as 'interface', not 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `interface Repo {\n    fun get(): Int\n}\n`));
    expect(nodes.find(n => n.label === "Repo")?.type).toBe("interface");
  });

  it("extracts an enum class as 'enum', not 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `enum class Color { RED, GREEN }\n`));
    expect(nodes.find(n => n.label === "Color")?.type).toBe("enum");
  });

  it("collapses a data class to 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `data class User(val id: Int)\n`));
    expect(nodes.find(n => n.label === "User")?.type).toBe("class");
  });

  it("collapses a sealed class to 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `sealed class Result\n`));
    expect(nodes.find(n => n.label === "Result")?.type).toBe("class");
  });

  it("collapses a plain object declaration to 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `object Singleton {\n    fun ping() {}\n}\n`));
    expect(nodes.find(n => n.label === "Singleton")?.type).toBe("class");
  });

  it("extracts correctly on the compact single-line interface form, despite the grammar reporting hasError on it (regression)", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `interface Repo { fun get(): Int }`));
    const repo = nodes.find(n => n.label === "Repo");
    expect(repo?.type).toBe("interface");
    expect(nodes.find(n => n.label === "get")?.type).toBe("method");
  });

  it("extracts correctly on the compact single-line override-method form, despite the grammar reporting hasError on it (regression)", async () => {
    const src = `open class Base\nclass D : Base() { override fun x() {} }`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "D")?.type).toBe("class");
    expect(nodes.find(n => n.label === "x")?.type).toBe("method");
  });

  it("distinguishes a class and an object of the same name in one file", async () => {
    const src = `class Foo {}\nobject Bar {}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.filter(n => n.type === "class")).toHaveLength(2);
  });
});

describe("KotlinParser member extraction", () => {
  it("attributes a class's method to the class, not the file", async () => {
    const src = `class Foo {\n    fun bar() {\n        return\n    }\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const foo = nodes.find(n => n.label === "Foo")!;
    const bar = nodes.find(n => n.label === "bar")!;
    expect(bar.type).toBe("method");
    expect(edges).toContainEqual({ source: foo.id, target: bar.id, relation: "defines" });
  });

  it("attributes an interface's abstract method (no body) to the interface, with no complexity", async () => {
    const src = `interface Repo {\n    fun get(): Int\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const repo = nodes.find(n => n.label === "Repo")!;
    const get = nodes.find(n => n.label === "get")!;
    expect(get.type).toBe("method");
    expect(get.complexity).toBeUndefined();
    expect(edges).toContainEqual({ source: repo.id, target: get.id, relation: "defines" });
  });

  it("scores an extension function correctly, with the real receiver-qualified name resolved", async () => {
    const src = `fun String.slugify(): String {\n    return this.lowercase()\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "slugify")?.type).toBe("function");
  });

  it("scores a generic top-level function", async () => {
    const src = `fun <T> identity(x: T): T = x\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "identity")?.type).toBe("function");
  });

  it("deliberately does not extract a companion object's members as methods of the enclosing class", async () => {
    const src = `class Foo {\n    companion object {\n        fun create(): Foo = Foo()\n    }\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "create")).toBeUndefined();
    // and it's not misattributed as a top-level function either
    expect(nodes.filter(n => n.type === "function")).toHaveLength(0);
  });

  it("deliberately does not extract a local (nested-inside-another-function) function as its own node", async () => {
    const src = `fun outer() {\n    fun inner() {\n        return 1\n    }\n    return inner()\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "inner")).toBeUndefined();
    expect(nodes.filter(n => n.type === "function")).toHaveLength(1);
  });
});

describe("KotlinParser duplicateHash", () => {
  const bodyOf = (varName: string, target: string) =>
    [
      `  if (${varName} > 0) {`,
      `    for (i in 0..${varName}) {`,
      `      if (i % 2 == 0) {`,
      `        ${target} += i`,
      `      }`,
      `    }`,
      `  }`,
      `  return ${target}`,
    ].join("\n");

  it("gives the same hash to renamed-but-structurally-identical functions", async () => {
    const srcA = `fun foo(x: Int): Int {\n  var acc = 0\n${bodyOf("x", "acc")}\n}`;
    const srcB = `fun bar(y: Int): Int {\n  var total = 0\n${bodyOf("y", "total")}\n}`;
    const a = (await parser.parse(fileInfo("a.kt", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.kt", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `fun foo(): Int {\n  return 1\n}\n`));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });
});

describe("KotlinParser calls edges", () => {
  it("emits a calls edge for a bare-identifier call to a same-file function", async () => {
    const src = `fun a(): Int {\n    return b()\n}\n\nfun b(): Int {\n    return 1\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const a = nodes.find(n => n.label === "a")!;
    const b = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: a.id, target: b.id, relation: "calls" });
  });

  it("does not emit a calls edge for a qualified this.x()/obj.x() call", async () => {
    const src = `class Foo {\n    fun bar() {\n        this.baz()\n    }\n    fun baz() {}\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const bar = nodes.find(n => n.label === "bar")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === bar.id)).toHaveLength(0);
  });

  it("emits a self-recursive calls edge", async () => {
    const src = `fun fact(n: Int): Int {\n    return if (n <= 1) 1 else n * fact(n - 1)\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const fact = nodes.find(n => n.label === "fact")!;
    expect(edges).toContainEqual({ source: fact.id, target: fact.id, relation: "calls" });
  });

  it("attributes a call inside a lambda_literal to the enclosing function", async () => {
    const src = `fun outer() {\n    val fn = { target() }\n    fn()\n}\n\nfun target() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const outer = nodes.find(n => n.label === "outer")!;
    const target = nodes.find(n => n.label === "target")!;
    expect(edges).toContainEqual({ source: outer.id, target: target.id, relation: "calls" });
  });

  it("attributes a same-file class method's call to another method of the same class", async () => {
    const src = `class Foo {\n    fun a() {\n        b()\n    }\n    fun b() {}\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.kt", src));
    const a = nodes.find(n => n.label === "a")!;
    const b = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: a.id, target: b.id, relation: "calls" });
  });
});
