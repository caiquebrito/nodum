import { describe, it, expect } from "vitest";
import parser from "./go.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".go", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("GoParser imports", () => {
  it("extracts a single import", async () => {
    const { imports } = await parser.parse(fileInfo("a.go", `package a\n\nimport "fmt"\n`));
    expect(imports).toEqual(["fmt"]);
  });

  it("extracts a grouped import block", async () => {
    const src = `package a\n\nimport (\n\t"fmt"\n\t"os"\n)\n`;
    const { imports } = await parser.parse(fileInfo("a.go", src));
    expect(imports).toEqual(["fmt", "os"]);
  });

  it("extracts the underlying path for an aliased import, not the alias", async () => {
    const src = `package a\n\nimport m "myapp/models"\n`;
    const { imports } = await parser.parse(fileInfo("a.go", src));
    expect(imports).toEqual(["myapp/models"]);
  });

  it("extracts a raw-string-quoted import path", async () => {
    const src = "package a\n\nimport `fmt`\n";
    const { imports } = await parser.parse(fileInfo("a.go", src));
    expect(imports).toEqual(["fmt"]);
  });

  it("dedupes a repeated import", async () => {
    const src = `package a\n\nimport (\n\t"fmt"\n\t"fmt"\n)\n`;
    const { imports } = await parser.parse(fileInfo("a.go", src));
    expect(imports).toEqual(["fmt"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.go", `package a\n`));
    expect(imports).toEqual([]);
  });
});

describe("GoParser type extraction", () => {
  it("extracts a struct", async () => {
    const src = `package a\n\ntype Server struct {\n\tName string\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    const server = nodes.find(n => n.label === "Server");
    expect(server?.type).toBe("struct");
    expect(server?.line).toBe(3);
  });

  it("extracts an interface", async () => {
    const src = `package a\n\ntype Handler interface {\n\tHandle() error\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "Handler")?.type).toBe("interface");
  });

  it("skips a plain defined-type declaration rather than mis-tagging it", async () => {
    const src = `package a\n\ntype Celsius float64\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "Celsius")).toBeUndefined();
  });

  it("extracts both a struct and an interface declared in one type block", async () => {
    const src = `package a\n\ntype (\n\tServer struct{}\n\tHandler interface{}\n)\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "Server")?.type).toBe("struct");
    expect(nodes.find(n => n.label === "Handler")?.type).toBe("interface");
  });
});

describe("GoParser method extraction", () => {
  it("attributes a value-receiver method to its struct", async () => {
    const src = `package a\n\ntype Server struct{}\n\nfunc (s Server) Name() string {\n\treturn "x"\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const server = nodes.find(n => n.label === "Server")!;
    const method = nodes.find(n => n.label === "Name")!;
    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: server.id, target: method.id, relation: "defines" });
  });

  it("attributes a pointer-receiver method to its struct", async () => {
    const src = `package a\n\ntype Server struct{}\n\nfunc (s *Server) Start() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const server = nodes.find(n => n.label === "Server")!;
    const method = nodes.find(n => n.label === "Start")!;
    expect(edges).toContainEqual({ source: server.id, target: method.id, relation: "defines" });
  });

  it("attributes a generic pointer-receiver method to its base type", async () => {
    const src = `package a\n\ntype Cache[K comparable, V any] struct{}\n\nfunc (c *Cache[K, V]) Get() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const cache = nodes.find(n => n.label === "Cache")!;
    const method = nodes.find(n => n.label === "Get")!;
    expect(edges).toContainEqual({ source: cache.id, target: method.id, relation: "defines" });
  });

  it("attaches a method to the file node when its receiver type isn't declared in this file", async () => {
    const src = `package a\n\nfunc (s *Server) Start() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const file = nodes.find(n => n.type === "file")!;
    const method = nodes.find(n => n.label === "Start")!;
    expect(edges).toContainEqual({ source: file.id, target: method.id, relation: "defines" });
  });

  it("does not extract a method as a top-level function", async () => {
    const src = `package a\n\ntype Server struct{}\n\nfunc (s Server) Name() string { return "x" }\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.filter(n => n.label === "Name")).toHaveLength(1);
  });
});

describe("GoParser function extraction", () => {
  it("extracts a top-level function with its line number", async () => {
    const { nodes } = await parser.parse(fileInfo("a.go", `package a\n\nfunc main() {}\n`));
    const main = nodes.find(n => n.label === "main");
    expect(main?.type).toBe("function");
    expect(main?.line).toBe(3);
  });

  it("does not separately extract a func_literal as its own node", async () => {
    const src = `package a\n\nfunc main() {\n\tfn := func() {}\n\t_ = fn\n}\n`;
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.filter(n => n.type === "function")).toHaveLength(1);
  });
});

describe("GoParser complexity", () => {
  it("scores a function with no decision points as 1", async () => {
    const { nodes } = await parser.parse(fileInfo("a.go", `package a\n\nfunc f() int {\n\treturn 1\n}\n`));
    expect(nodes.find(n => n.label === "f")?.complexity).toBe(1);
  });

  it("counts if/for/&&/|| as decision points", async () => {
    const src = [
      "package a",
      "",
      "func f(x int) int {",
      "\tif x > 0 && x < 10 {",
      "\t\tfor i := 0; i < x; i++ {",
      "\t\t}",
      "\t}",
      "\treturn x",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    // base 1 + if + && + for = 4
    expect(nodes.find(n => n.label === "f")?.complexity).toBe(4);
  });

  it("counts an else-if branch, nested as a child if_statement, the same as a top-level if", async () => {
    const src = [
      "package a",
      "",
      "func f(x int) int {",
      "\tif x > 0 {",
      "\t\treturn 1",
      "\t} else if x < 0 {",
      "\t\treturn -1",
      "\t}",
      "\treturn 0",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "f")?.complexity).toBe(3); // base 1 + if + else-if
  });

  it("counts switch cases but not the default case", async () => {
    const src = [
      "package a",
      "",
      "func f(x int) int {",
      "\tswitch x {",
      "\tcase 1:",
      "\t\treturn 1",
      "\tcase 2:",
      "\t\treturn 2",
      "\tdefault:",
      "\t\treturn 0",
      "\t}",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "f")?.complexity).toBe(3); // base 1 + 2 cases, default excluded
  });

  it("descends into a func_literal's branches, rolling them into the enclosing function", async () => {
    const src = [
      "package a",
      "",
      "func f() {",
      "\tfn := func() {",
      "\t\tif true {",
      "\t\t}",
      "\t}",
      "\tfn()",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "f")?.complexity).toBe(2); // base 1 + the lambda's if
  });

  it("does not double-count a nested method declaration's branches into a top-level function", async () => {
    const src = [
      "package a",
      "",
      "func outer() {",
      "\tif true {",
      "\t}",
      "}",
      "",
      "func inner() {",
      "\tif true {",
      "\t}",
      "\tif true {",
      "\t}",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "outer")?.complexity).toBe(2);
    expect(nodes.find(n => n.label === "inner")?.complexity).toBe(3);
  });
});

describe("GoParser duplicateHash", () => {
  const bodyOf = (varName: string) =>
    [
      `\tif ${varName} > 0 {`,
      `\t\tfor i := 0; i < ${varName}; i++ {`,
      `\t\t}`,
      `\t}`,
      `\treturn ${varName}`,
    ].join("\n");

  it("gives the same hash to renamed-but-structurally-identical functions", async () => {
    const srcA = `package a\n\nfunc foo(x int) int {\n${bodyOf("x")}\n}\n`;
    const srcB = `package a\n\nfunc bar(y int) int {\n${bodyOf("y")}\n}\n`;
    const a = (await parser.parse(fileInfo("a.go", srcA))).nodes.find(n => n.label === "foo");
    const b = (await parser.parse(fileInfo("b.go", srcB))).nodes.find(n => n.label === "bar");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small function no duplicateHash", async () => {
    const { nodes } = await parser.parse(fileInfo("a.go", `package a\n\nfunc f() int {\n\treturn 1\n}\n`));
    expect(nodes.find(n => n.label === "f")?.duplicateHash).toBeUndefined();
  });
});

describe("GoParser calls edges", () => {
  it("emits a calls edge for a bare-identifier call to a same-file function", async () => {
    const src = `package a\n\nfunc a() int {\n\treturn b()\n}\n\nfunc b() int {\n\treturn 1\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const aNode = nodes.find(n => n.label === "a")!;
    const bNode = nodes.find(n => n.label === "b")!;
    expect(edges).toContainEqual({ source: aNode.id, target: bNode.id, relation: "calls" });
  });

  it("does not emit a calls edge for a qualified pkg.Fn() call", async () => {
    const src = `package a\n\nimport "fmt"\n\nfunc f() {\n\tfmt.Println("x")\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const f = nodes.find(n => n.label === "f")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === f.id)).toHaveLength(0);
  });

  it("emits a self-recursive calls edge", async () => {
    const src = `package a\n\nfunc fact(n int) int {\n\tif n <= 1 {\n\t\treturn 1\n\t}\n\treturn n * fact(n-1)\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const fact = nodes.find(n => n.label === "fact")!;
    expect(edges).toContainEqual({ source: fact.id, target: fact.id, relation: "calls" });
  });

  it("attributes a call inside a func_literal to the enclosing function, not a separate node", async () => {
    const src = `package a\n\nfunc outer() {\n\tfn := func() {\n\t\ttarget()\n\t}\n\tfn()\n}\n\nfunc target() {}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.go", src));
    const outer = nodes.find(n => n.label === "outer")!;
    const target = nodes.find(n => n.label === "target")!;
    expect(edges).toContainEqual({ source: outer.id, target: target.id, relation: "calls" });
  });
});

describe("GoParser cognitive complexity (spec 045)", () => {
  it("scores a function with no decision points as 0", async () => {
    const { nodes } = await parser.parse(fileInfo("a.go", "package a\n\nfunc f() int {\n\treturn 1\n}\n"));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(0);
  });

  it("gives nested ifs a higher cognitive score than sequential ifs, unlike cyclomatic", async () => {
    const seq = [
      "package a",
      "",
      "func seq(x int) {",
      "\tif x == 1 {",
      "\t}",
      "\tif x == 2 {",
      "\t}",
      "\tif x == 3 {",
      "\t}",
      "}",
    ].join("\n");
    const nested = [
      "package a",
      "",
      "func nested(x int) {",
      "\tif x == 1 {",
      "\t\tif x == 2 {",
      "\t\t\tif x == 3 {",
      "\t\t\t}",
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const seqNode = (await parser.parse(fileInfo("a.go", seq))).nodes.find(n => n.label === "seq");
    const nestedNode = (await parser.parse(fileInfo("b.go", nested))).nodes.find(n => n.label === "nested");
    expect(seqNode?.complexity).toBe(nestedNode?.complexity);
    expect(seqNode?.cognitiveComplexity).toBe(3);
    expect(nestedNode?.cognitiveComplexity).toBe(6);
  });

  it("collapses a boolean-operator chain to +1", async () => {
    const src = ["package a", "", "func f(a, b, c bool) {", "\tif a && b && c {", "\t}", "}"].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(2);
  });

  it("scores a self-recursive call as +1", async () => {
    const src = [
      "package a",
      "",
      "func fact(n int) int {",
      "\tif n <= 1 {",
      "\t\treturn 1",
      "\t}",
      "\treturn fact(n-1) + n",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "fact")?.cognitiveComplexity).toBe(2);
  });

  it("rolls a func_literal's branches into the enclosing function, at one deeper nesting level", async () => {
    const src = [
      "package a",
      "",
      "func f() {",
      "\tfn := func() {",
      "\t\tif true {",
      "\t\t}",
      "\t}",
      "\tfn()",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.go", src));
    expect(nodes.find(n => n.label === "f")?.cognitiveComplexity).toBe(2); // the if, at depth 1 inside the func_literal
  });
});
