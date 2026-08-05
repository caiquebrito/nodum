import { describe, it, expect, vi } from "vitest";
import { Parser as TSParser } from "web-tree-sitter";
import parser from "./kotlin.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".kt", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("KotlinParser resource cleanup (spec 056)", () => {
  it("deletes the per-call TSParser instance after parsing, not just the tree", async () => {
    const deleteSpy = vi.spyOn(TSParser.prototype, "delete");
    await parser.parse(fileInfo("a.kt", `fun foo(): Int = 1\n`));
    expect(deleteSpy).toHaveBeenCalled();
    deleteSpy.mockRestore();
  });
});

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

describe("KotlinParser expect/actual platform modifiers (spec 055)", () => {
  it("tags a top-level expect fun", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `expect fun platformName(): String\n`));
    expect(nodes.find(n => n.label === "platformName")?.platformModifier).toBe("expect");
  });

  it("tags a top-level actual fun", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `actual fun platformName(): String = "x"\n`));
    expect(nodes.find(n => n.label === "platformName")?.platformModifier).toBe("actual");
  });

  it("tags an expect class", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `expect class Foo\n`));
    expect(nodes.find(n => n.label === "Foo")?.platformModifier).toBe("expect");
  });

  it("tags an actual object", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `actual object Foo {}\n`));
    expect(nodes.find(n => n.label === "Foo")?.platformModifier).toBe("actual");
  });

  it("tags an internal expect object — a visibility modifier alongside platform_modifier doesn't break detection", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `internal expect object Foo\n`));
    expect(nodes.find(n => n.label === "Foo")?.platformModifier).toBe("expect");
  });

  it("leaves platformModifier unset for a plain declaration with no platform modifier", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `fun regular(): Int = 1\nclass Plain {}\n`));
    expect(nodes.find(n => n.label === "regular")?.platformModifier).toBeUndefined();
    expect(nodes.find(n => n.label === "Plain")?.platformModifier).toBeUndefined();
  });

  it("tags a member with its own explicit modifier inside an actual class body (spec 075)", async () => {
    const src = `actual class Foo {\n  actual fun bar(): Int = 42\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "Foo")?.platformModifier).toBe("actual");
    expect(nodes.find(n => n.label === "bar")?.platformModifier).toBe("actual");
  });

  it("tags a member with no modifier of its own by inheriting the enclosing expect class's (spec 075)", async () => {
    const src = `expect class HttpClientEngineProvider {\n  fun provideEngine(): String\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "HttpClientEngineProvider")?.platformModifier).toBe("expect");
    expect(nodes.find(n => n.label === "provideEngine")?.platformModifier).toBe("expect");
  });

  it("inherits actual for a member with no modifier of its own inside an actual class (spec 075)", async () => {
    const src = `actual class HttpClientEngineProvider {\n  fun provideEngine(): String = "engine"\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "provideEngine")?.platformModifier).toBe("actual");
  });

  it("leaves a member of a plain (non-expect/actual) class untagged (spec 075)", async () => {
    const src = `class Foo {\n  fun bar(): Int = 42\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "Foo")?.platformModifier).toBeUndefined();
    expect(nodes.find(n => n.label === "bar")?.platformModifier).toBeUndefined();
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

describe("KotlinParser referencedIdentifiers (same-package dead-code resolution)", () => {
  it("includes a bare identifier used as a navigation_expression receiver", async () => {
    const src = `fun themeColor(): Int {\n    return Palette.primary\n}\n`;
    const { nodes } = await parser.parse(fileInfo("Theme.kt", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    expect(fileNode.referencedIdentifiers).toContain("Palette");
  });

  it("includes a bare call-target identifier", async () => {
    const src = `fun a(): Int {\n    return helper()\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    expect(fileNode.referencedIdentifiers).toContain("helper");
  });

  it("is set only on the file node, deduplicated", async () => {
    const src = `fun a(): Int {\n    val x = Palette.primary\n    val y = Palette.primary\n    return x + y\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    expect(fileNode.referencedIdentifiers!.filter(id => id === "Palette")).toHaveLength(1);
    expect(nodes.find(n => n.label === "a")!.referencedIdentifiers).toBeUndefined();
  });
});

describe("KotlinParser declaredTopLevelNames (same-package dead-code resolution)", () => {
  it("includes a top-level property name even though it gets no Node of its own", async () => {
    const src = `val commonModule = buildModule()\n`;
    const { nodes } = await parser.parse(fileInfo("CommonModule.kt", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    expect(fileNode.declaredTopLevelNames).toEqual(["commonModule"]);
    expect(nodes.map(n => n.type)).toEqual(["file"]); // no property Node created
  });

  it("includes top-level function and class names alongside property names", async () => {
    const src = `class Foo\nfun bar() {}\nval baz = 1\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    expect(new Set(fileNode.declaredTopLevelNames)).toEqual(new Set(["Foo", "bar", "baz"]));
  });
});

describe("KotlinParser cognitive complexity (spec 045)", () => {
  it("scores a function with no decision points as 0", async () => {
    const { nodes } = await parser.parse(fileInfo("a.kt", `fun foo(): Int {\n  return 1\n}\n`));
    expect(nodes.find(n => n.label === "foo")?.cognitiveComplexity).toBe(0);
  });

  it("gives nested ifs a higher cognitive score than sequential ifs, unlike cyclomatic", async () => {
    const seq = `fun seq(x: Int) {\n    if (x == 1) {}\n    if (x == 2) {}\n    if (x == 3) {}\n}\n`;
    const nested = `fun nested(x: Int) {\n    if (x == 1) {\n        if (x == 2) {\n            if (x == 3) {}\n        }\n    }\n}\n`;
    const seqNode = (await parser.parse(fileInfo("a.kt", seq))).nodes.find(n => n.label === "seq");
    const nestedNode = (await parser.parse(fileInfo("b.kt", nested))).nodes.find(n => n.label === "nested");
    expect(seqNode?.complexity).toBe(nestedNode?.complexity);
    expect(seqNode?.cognitiveComplexity).toBe(3);
    expect(nestedNode?.cognitiveComplexity).toBe(6);
  });

  it("collapses a boolean-operator chain to +1", async () => {
    const src = `fun foo(a: Boolean, b: Boolean, c: Boolean) {\n    if (a && b && c) {}\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.cognitiveComplexity).toBe(2);
  });

  it("scores a self-recursive call as +1", async () => {
    const src = `fun fact(n: Int): Int {\n    if (n <= 1) {\n        return 1\n    }\n    return fact(n - 1) + n\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "fact")?.cognitiveComplexity).toBe(2);
  });

  it("rolls a lambda_literal's branches into the enclosing function, at one deeper nesting level", async () => {
    const src = `fun foo() {\n    val fn = {\n        if (true) {}\n    }\n    fn()\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    expect(nodes.find(n => n.label === "foo")?.cognitiveComplexity).toBe(2); // the if, at depth 1 inside the lambda
  });
});
