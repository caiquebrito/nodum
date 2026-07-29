import { describe, it, expect } from "vitest";
import parser from "./swift.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".swift", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("SwiftParser imports", () => {
  it("extracts a plain module import", async () => {
    const { imports } = await parser.parse(fileInfo("a.swift", `import Foundation\n`));
    expect(imports).toEqual(["Foundation"]);
  });

  it("extracts a dotted submodule import", async () => {
    const { imports } = await parser.parse(fileInfo("a.swift", `import UIKit.UIView\n`));
    expect(imports).toEqual(["UIKit.UIView"]);
  });

  it("extracts a @testable import the same as a plain one", async () => {
    const { imports } = await parser.parse(fileInfo("a.swift", `@testable import MyModule\n`));
    expect(imports).toEqual(["MyModule"]);
  });

  it("deduplicates repeated imports of the same module", async () => {
    const { imports } = await parser.parse(fileInfo("a.swift", `import Foundation\nimport Foundation\n`));
    expect(imports).toEqual(["Foundation"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.swift", `func foo() {}\n`));
    expect(imports).toEqual([]);
  });
});

describe("SwiftParser type extraction", () => {
  it("extracts a class as type 'class'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `class Foo {}\n`));
    expect(nodes.find(n => n.label === "Foo")?.type).toBe("class");
  });

  it("extracts a struct as type 'struct' — the same grammar node as class, disambiguated by keyword", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `struct Foo {}\n`));
    expect(nodes.find(n => n.label === "Foo")?.type).toBe("struct");
  });

  it("extracts an enum as type 'enum'", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `enum Status {\n  case active\n}\n`));
    expect(nodes.find(n => n.label === "Status")?.type).toBe("enum");
  });

  it("extracts a protocol as type 'protocol' — a real distinct grammar node, not a class_declaration", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `protocol Greeter {\n  func greet()\n}\n`));
    expect(nodes.find(n => n.label === "Greeter")?.type).toBe("protocol");
  });

  it("extracts an extension as type 'extension' with a distinguishing label and id", async () => {
    const src = `class Foo {}\nextension Foo {\n  func bar() {}\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    const classNode = nodes.find(n => n.label === "Foo" && n.type === "class");
    const extNode = nodes.find(n => n.type === "extension");
    expect(classNode).toBeDefined();
    expect(extNode).toBeDefined();
    expect(extNode?.label).toBe("Foo (extension)");
    expect(extNode?.id).not.toBe(classNode?.id); // no id collision between class Foo and extension Foo
  });

  it("extracts an actor as type 'class' — no dedicated NodeType, closest existing semantic", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `actor Cache {}\n`));
    expect(nodes.find(n => n.label === "Cache")?.type).toBe("class");
  });

  it("extracts a final class the same as a plain class — 'final' is a modifiers node preceding the keyword", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `final class Foo {}\n`));
    expect(nodes.find(n => n.label === "Foo")?.type).toBe("class");
  });

  it("gives every enum node a distinct body node type (enum_class_body) confirming the disambiguation is real, not name-based luck", async () => {
    // Regression guard: if a future grammar bump changes how enum's body is
    // shaped, this class of test (checking the *output* NodeType, not the
    // internal node type directly) still catches a wrong classification.
    const { nodes: enumNodes } = await parser.parse(fileInfo("a.swift", `enum E {\n  case a\n}\n`));
    const { nodes: classNodes } = await parser.parse(fileInfo("b.swift", `class C {}\n`));
    expect(enumNodes.find(n => n.label === "E")?.type).toBe("enum");
    expect(classNodes.find(n => n.label === "C")?.type).toBe("class");
  });
});

describe("SwiftParser member extraction", () => {
  it("attributes a method to its class (classId->methodId), not the file", async () => {
    const src = `class Foo {\n  func bar() {}\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const classNode = nodes.find(n => n.label === "Foo")!;
    const method = nodes.find(n => n.label === "bar")!;
    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: classNode.id, target: method.id, relation: "defines" });
    expect(edges).not.toContainEqual({ source: fileNode.id, target: method.id, relation: "defines" });
  });

  it("labels init and deinit correctly, with no name field to fall back on", async () => {
    const src = `class Foo {\n  init() {}\n  deinit {}\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "init")?.type).toBe("method");
    expect(nodes.find(n => n.label === "deinit")?.type).toBe("method");
  });

  it("gives a protocol requirement (no body) undefined complexity/duplicateHash without throwing", async () => {
    const src = `protocol Greeter {\n  func greet()\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    const method = nodes.find(n => n.label === "greet");
    expect(method?.type).toBe("method");
    expect(method?.complexity).toBeUndefined();
    expect(method?.duplicateHash).toBeUndefined();
  });

  it("attributes an extension's method to the extension node, not the original type", async () => {
    const src = `class Foo {}\nextension Foo {\n  func bar() {}\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const extNode = nodes.find(n => n.type === "extension")!;
    const method = nodes.find(n => n.label === "bar")!;
    expect(edges).toContainEqual({ source: extNode.id, target: method.id, relation: "defines" });
  });

  it("attributes a top-level function to the file, not any type", async () => {
    const src = `func helper() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const helper = nodes.find(n => n.label === "helper")!;
    expect(helper.type).toBe("function");
    expect(edges).toContainEqual({ source: fileNode.id, target: helper.id, relation: "defines" });
  });
});

describe("SwiftParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `func foo() {\n  return 1\n}\n`));
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(1);
  });

  it("counts if/guard/for/while/switch-case/ternary/&&/||/?? via real AST node types", async () => {
    const src = [
      "func foo(x: Int) -> Int {",
      "  guard x > 0 else { return 0 }",
      "  if x > 1 {",
      "    for i in 0..<x {}",
      "    while x > 100 {}",
      "  }",
      "  switch x {",
      "  case 1: break",
      "  case 2: break",
      "  default: break",
      "  }",
      "  let a = x > 0 && x < 10 || x == 5",
      "  let b = a ?? false",
      "  return x > 0 ? 1 : 0",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    // base 1 + guard + if + for + while + 2 cases (not default) + && + || + ?? + ternary = 11
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(11);
  });

  it("does not count a bare 'default:' switch entry as a decision point", async () => {
    const src = [
      "func foo(x: Int) {",
      "  switch x {",
      "  case 1: break",
      "  default: break",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    // base 1 + 1 case (not default) = 2
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(2);
  });

  it("counts do/catch as a decision point", async () => {
    const src = [
      "func foo() {",
      "  do {",
      "    try bar()",
      "  } catch {",
      "    print(1)",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    // base 1 + do + catch = 3
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(3);
  });

  it("does not fold a local function's branches into the enclosing function's score", async () => {
    // `inner` is a local function — not extracted as its own node (see
    // "SwiftParser scope reductions" below) — but its two `if`s still must
    // not be double-counted into `outer`'s complexity.
    const src = [
      "func outer() {",
      "  if true {}",
      "  func inner() {",
      "    if true {}",
      "    if true {}",
      "  }",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2); // base 1 + its own if
  });

  it("scores a class method", async () => {
    const src = `class Foo {\n  func bar(x: Int) -> Int {\n    if x > 0 {\n      return 1\n    }\n    return 0\n  }\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "bar")?.complexity).toBe(2);
  });
});

describe("SwiftParser duplicateHash", () => {
  const bodyOf = (varName: string, target: string) =>
    [
      `    if ${varName} > 0 {`,
      `      for i in 0..<${varName} {`,
      `        if i % 2 == 0 {`,
      `          ${target} += i`,
      `        }`,
      `      }`,
      `    }`,
      `    return ${target}`,
    ].join("\n");

  it("gives the same hash to renamed-but-structurally-identical functions across two different files", async () => {
    const srcA = `func foo(x: Int) -> Int {\n  var acc = 0\n${bodyOf("x", "acc")}\n}\n`;
    const srcB = `func bar(y: Int) -> Int {\n  var total = 0\n${bodyOf("y", "total")}\n}\n`;
    const a = (await parser.parse(fileInfo("a.swift", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.swift", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", `func foo() {\n  return 1\n}\n`));
    expect(nodes.find(n => n.label === "foo")?.duplicateHash).toBeUndefined();
  });
});

describe("SwiftParser calls edges", () => {
  it("emits a calls edge for a bare-identifier call to a same-file function", async () => {
    const src = `func a() {\n  b()\n}\nfunc b() {\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const a = nodes.find(n => n.label === "a")!;
    const b = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: a.id, target: b.id, relation: "calls" });
  });

  it("does not emit a calls edge for a qualified self.x() call", async () => {
    const src = `class Foo {\n  func bar() {\n    self.baz()\n  }\n  func baz() {\n  }\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz")!;
    expect(edges).not.toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("does not emit a calls edge to an unresolvable name", async () => {
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", `func a() {\n  unknownFn()\n}\n`));
    const a = nodes.find(n => n.label === "a")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === a.id)).toHaveLength(0);
  });

  it("emits a self-recursive calls edge", async () => {
    // `fact(n - 1) * n`, not `n * fact(n - 1)` — the latter is a real
    // grammar quirk in this Swift parser: a call immediately preceded by a
    // binary operator gets folded into a `multiplicative_expression` as the
    // call's own callee (`n * fact` parses as one unit before the `(`),
    // which is unresolvable as a bare call regardless of implementation.
    // Verified empirically; ordering the call first avoids it.
    const src = `func fact(n: Int) -> Int {\n  return n <= 1 ? 1 : fact(n - 1) * n\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.swift", src));
    const fact = nodes.find(n => n.label === "fact")!;
    expect(edges).toContainEqual({ source: fact.id, target: fact.id, relation: "calls" });
  });
});

describe("SwiftParser scope reductions", () => {
  it("does not extract a local (nested) function as its own node — top-level/member functions only", async () => {
    // Deliberate scope reduction: only module-scope functions and type
    // members are extracted. A function nested inside another function's
    // body is invisible to the graph, same as it would be to a query-based
    // discovery pass that only looks at root's own children and each
    // type's own direct member list.
    const src = "func outer() {\n  func inner() {}\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "inner")).toBeUndefined();
    expect(nodes.find(n => n.label === "outer")).toBeDefined();
  });
});

describe("SwiftParser cognitive complexity (spec 045)", () => {
  it("scores a function with no decision points as 0", async () => {
    const { nodes } = await parser.parse(fileInfo("a.swift", "func f() -> Int {\n    return 1\n}\n"));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(0);
  });

  it("gives nested ifs a higher cognitive score than sequential ifs, unlike cyclomatic", async () => {
    const seq = "func seq(_ x: Int) {\n    if x == 1 {}\n    if x == 2 {}\n    if x == 3 {}\n}\n";
    const nested = "func nested(_ x: Int) {\n    if x == 1 {\n        if x == 2 {\n            if x == 3 {}\n        }\n    }\n}\n";
    const seqNode = (await parser.parse(fileInfo("a.swift", seq))).nodes.find(n => n.label === "seq");
    const nestedNode = (await parser.parse(fileInfo("b.swift", nested))).nodes.find(n => n.label === "nested");
    expect(seqNode?.complexity).toBe(nestedNode?.complexity);
    expect(seqNode?.cognitiveComplexity).toBe(3);
    expect(nestedNode?.cognitiveComplexity).toBe(6);
  });

  it("collapses a boolean-operator chain to +1", async () => {
    const src = "func f(_ a: Bool, _ b: Bool, _ c: Bool) {\n    if a && b && c {}\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(2);
  });

  it("scores a self-recursive call as +1", async () => {
    const src = "func fact(_ n: Int) -> Int {\n    if n <= 1 {\n        return 1\n    }\n    return fact(n - 1) + n\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "fact")?.cognitiveComplexity).toBe(2);
  });

  it("counts a guard statement as a real decision point", async () => {
    const src = "func f(_ x: Int?) -> Int {\n    guard let y = x else {\n        return 0\n    }\n    return y\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(1);
  });

  it("rolls a closure's branches into the enclosing function, at one deeper nesting level", async () => {
    const src = "func f() {\n    let g = {\n        if true {}\n    }\n    g()\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.swift", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(2); // the if, at depth 1 inside the closure
  });
});
