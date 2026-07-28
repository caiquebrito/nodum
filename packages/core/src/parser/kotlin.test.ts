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

  it("counts if/for/&&/|| via brace-body extraction, excluding ternary-like '?'", async () => {
    const src = [
      "fun foo(x: Int?): Int {",
      "  if (x != null && x > 0) {",
      "    for (i in 0..x) {}",
      "  }",
      "  return x ?: 0",
      "}",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.kt", src));
    // base 1 + if + && + for = 4 (the elvis '?:' is NOT counted, by design)
    expect(nodes.find(n => n.label === "foo")?.complexity).toBe(4);
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
