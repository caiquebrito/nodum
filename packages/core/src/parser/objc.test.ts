import { describe, it, expect } from "vitest";
import parser from "./objc.js";
import type { FileInfo } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: path.endsWith(".h") ? ".h" : ".m", content, hash: "h", mtimeMs: 1, size: content.length };
}

describe("ObjCParser imports", () => {
  it("does not resolve an angle-bracket (external framework) import as a specifier worth extracting", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `#import <Foundation/Foundation.h>\n`));
    expect(imports).toEqual([]);
  });

  it("extracts a quoted #import's bare filename", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `#import "Helper.h"\n`));
    expect(imports).toEqual(["Helper.h"]);
  });

  it("extracts a quoted #include the same as #import", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `#include "Other.h"\n`));
    expect(imports).toEqual(["Other.h"]);
  });

  it("extracts an @import module name", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `@import MyModule;\n`));
    expect(imports).toEqual(["MyModule"]);
  });

  it("deduplicates repeated imports of the same specifier", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `#import "Helper.h"\n#import "Helper.h"\n`));
    expect(imports).toEqual(["Helper.h"]);
  });

  it("returns an empty array when there are no imports", async () => {
    const { imports } = await parser.parse(fileInfo("a.m", `void helper() {}\n`));
    expect(imports).toEqual([]);
  });
});

describe("ObjCParser declaration/definition split", () => {
  it("extracts a class node from @implementation", async () => {
    const src = `@implementation Foo\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.label === "Foo")?.type).toBe("class");
  });

  it("does NOT extract a class node from a bare @interface — the single most important test in this file", async () => {
    const src = `@interface Foo : NSObject\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.h", src));
    expect(nodes.find(n => n.label === "Foo" && n.type === "class")).toBeUndefined();
    // the file node still exists — an interface-only header just contributes nothing beyond that
    expect(nodes.find(n => n.type === "file")).toBeDefined();
  });

  it("extracts a protocol node from @protocol", async () => {
    const src = `@protocol Drawable\n- (void)draw;\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.h", src));
    expect(nodes.find(n => n.label === "Drawable")?.type).toBe("protocol");
  });

  it("extracts an extension node from a category @implementation, detected via the category field", async () => {
    const src = `@implementation Foo (Extras)\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    const ext = nodes.find(n => n.type === "extension");
    expect(ext).toBeDefined();
    expect(ext?.label).toBe("Foo (Extras)");
  });

  it("does not extract a node from a category @interface either — same declaration/definition rule", async () => {
    const src = `@interface Foo (Extras)\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.h", src));
    expect(nodes.find(n => n.type === "extension")).toBeUndefined();
  });

  it("gives a same-file @implementation Foo and @implementation Foo (Extras) distinct, non-colliding ids", async () => {
    const src = `@implementation Foo\n@end\n@implementation Foo (Extras)\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    const classNode = nodes.find(n => n.type === "class");
    const extNode = nodes.find(n => n.type === "extension");
    expect(classNode?.id).not.toBe(extNode?.id);
  });
});

describe("ObjCParser method extraction", () => {
  it("attributes a method to its class (classId->methodId), not the file", async () => {
    const src = `@implementation Foo\n- (void)bar {\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const classNode = nodes.find(n => n.label === "Foo")!;
    const method = nodes.find(n => n.label === "bar")!;
    expect(method.type).toBe("method");
    expect(edges).toContainEqual({ source: classNode.id, target: method.id, relation: "defines" });
    expect(edges).not.toContainEqual({ source: fileNode.id, target: method.id, relation: "defines" });
  });

  it("labels a zero-arg method with its bare name (no colon)", async () => {
    const src = `@implementation Foo\n- (void)bar {\n}\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.label).toBe("bar");
  });

  it("labels a multi-part selector with every segment plus its colon", async () => {
    const src = `@implementation Foo\n- (void)doThing:(int)a withOther:(int)b {\n}\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.label).toBe("doThing:withOther:");
  });

  it("gives a protocol method (no body) undefined complexity/duplicateHash without throwing", async () => {
    const src = `@protocol Drawable\n- (void)draw;\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.h", src));
    const method = nodes.find(n => n.type === "method");
    expect(method?.label).toBe("draw");
    expect(method?.complexity).toBeUndefined();
    expect(method?.duplicateHash).toBeUndefined();
  });

  it("does not crash on and does not extract a mis-parsed @property as a method", async () => {
    const src = `@implementation Foo\n@property (nonatomic) int x;\n- (void)bar {\n}\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    const methods = nodes.filter(n => n.type === "method");
    expect(methods).toHaveLength(1);
    expect(methods[0].label).toBe("bar");
  });

  it("attributes a top-level C function to the file, not any type", async () => {
    const src = `void helper() {\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const helper = nodes.find(n => n.label === "helper")!;
    expect(helper.type).toBe("function");
    expect(edges).toContainEqual({ source: fileNode.id, target: helper.id, relation: "defines" });
  });

  it("extracts a static C helper declared as a direct child of an @implementation block — a real idiom, not true file top-level", async () => {
    const src = `@implementation Foo\n\nstatic int helper(int x) {\n  return x + 1;\n}\n\n- (void)bar {\n}\n\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const fileNode = nodes.find(n => n.type === "file")!;
    const helper = nodes.find(n => n.label === "helper")!;
    expect(helper?.type).toBe("function");
    expect(edges).toContainEqual({ source: fileNode.id, target: helper.id, relation: "defines" });
  });
});

describe("ObjCParser complexity", () => {
  it("scores a method with no decision points as 1", async () => {
    const src = `@implementation Foo\n- (void)bar {\n}\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.complexity).toBe(1);
  });

  it("counts if/for/while/do-while/switch-case(not default)/ternary/&&/|| via real AST node types", async () => {
    const src = [
      "@implementation Foo",
      "- (void)bar:(int)x {",
      "  if (x > 0 && x < 10) {",
      "    for (int i = 0; i < x; i++) {}",
      "  }",
      "  while (x > 100) {}",
      "  do { x++; } while (x < 5);",
      "  switch (x) {",
      "    case 1: break;",
      "    case 2: break;",
      "    default: break;",
      "  }",
      "  int y = x > 0 ? 1 : 0;",
      "  BOOL z = (x > 0) || (x < -10);",
      "}",
      "@end",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    // base 1 + if + && + for + while + do + 2 cases (not default) + ternary + || = 10
    expect(nodes.find(n => n.type === "method")?.complexity).toBe(10);
  });

  it("counts a @try/@catch as a decision point", async () => {
    const src = [
      "@implementation Foo",
      "- (void)bar {",
      "  @try {",
      "    int x = 1;",
      "  } @catch (NSException *e) {",
      "    int y = 0;",
      "  }",
      "}",
      "@end",
    ].join("\n");
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    // base 1 + catch = 2
    expect(nodes.find(n => n.type === "method")?.complexity).toBe(2);
  });

  it("scores a top-level C function", async () => {
    const src = "int helper(int x) {\n  if (x > 0) {\n    return 1;\n  }\n  return 0;\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.label === "helper")?.complexity).toBe(2);
  });
});

describe("ObjCParser duplicateHash", () => {
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

  it("gives the same hash to renamed-but-structurally-identical methods across two different files", async () => {
    const srcA = `@implementation A\n- (int)foo:(int)x {\n    int acc = 0;\n${bodyOf("x", "acc")}\n}\n@end\n`;
    const srcB = `@implementation B\n- (int)bar:(int)y {\n    int total = 0;\n${bodyOf("y", "total")}\n}\n@end\n`;
    const a = (await parser.parse(fileInfo("a.m", srcA))).nodes.find(n => n.type === "method");
    const b = (await parser.parse(fileInfo("b.m", srcB))).nodes.find(n => n.type === "method");
    expect(a?.duplicateHash).toBeDefined();
    expect(a?.duplicateHash).toBe(b?.duplicateHash);
  });

  it("gives a small method no duplicateHash", async () => {
    const src = `@implementation Foo\n- (int)bar {\n  return 1;\n}\n@end\n`;
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.duplicateHash).toBeUndefined();
  });
});

describe("ObjCParser calls edges", () => {
  it("emits a calls edge for a [self x] message send — a deliberate divergence from spec 034's bare-call-only rule", async () => {
    const src = `@implementation Foo\n- (void)bar {\n  [self baz];\n}\n- (void)baz {\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz")!;
    expect(edges).toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("emits a calls edge for a [super x] message send", async () => {
    const src = `@implementation Foo\n- (void)bar {\n  [super baz];\n}\n- (void)baz {\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz")!;
    expect(edges).toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("emits a calls edge for a bare C function call", async () => {
    const src = `@implementation Foo\n- (void)bar {\n  helper();\n}\n@end\nvoid helper() {\n}\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const helper = nodes.find(n => n.label === "helper")!;
    expect(edges).toContainEqual({ source: bar.id, target: helper.id, relation: "calls" });
  });

  it("does not emit a calls edge for a message send to an arbitrary receiver", async () => {
    const src = `@implementation Foo\n- (void)bar {\n  [obj doThing:1];\n}\n- (void)doThing:(int)x {\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const doThing = nodes.find(n => n.label === "doThing:")!;
    expect(edges).not.toContainEqual({ source: bar.id, target: doThing.id, relation: "calls" });
  });

  it("does not emit a calls edge to an unresolvable selector", async () => {
    const src = `@implementation Foo\n- (void)bar {\n  [self unknownSelector];\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    expect(edges.filter(e => e.relation === "calls" && e.source === bar.id)).toHaveLength(0);
  });

  it("resolves a [self x:arg] selector correctly even when the argument is itself a bare identifier (a variable, not a literal)", async () => {
    // Regression case: the selector part ("baz") and the argument ("y") are
    // both plain `identifier` nodes here, so a type-based ("count
    // non-identifiers") heuristic can't tell them apart — this must be
    // resolved by position, not by node type.
    const src = `@implementation Foo\n- (int)bar {\n  int y = 1;\n  return [self baz:y];\n}\n- (int)baz:(int)y {\n  return y;\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const bar = nodes.find(n => n.label === "bar")!;
    const baz = nodes.find(n => n.label === "baz:")!;
    expect(edges).toContainEqual({ source: bar.id, target: baz.id, relation: "calls" });
  });

  it("emits a self-recursive calls edge", async () => {
    const src = `@implementation Foo\n- (int)fact:(int)n {\n  if (n <= 1) {\n    return 1;\n  }\n  return n * [self fact:n - 1];\n}\n@end\n`;
    const { nodes, edges } = await parser.parse(fileInfo("a.m", src));
    const fact = nodes.find(n => n.type === "method")!;
    expect(edges).toContainEqual({ source: fact.id, target: fact.id, relation: "calls" });
  });
});

describe("ObjCParser cognitive complexity (spec 045)", () => {
  it("scores a method with no decision points as 0", async () => {
    const src = "@implementation Foo\n- (void)bar {\n}\n@end\n";
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.cognitiveComplexity).toBe(0);
  });

  it("gives nested ifs a higher cognitive score than sequential ifs, unlike cyclomatic", async () => {
    const seq = "@implementation Foo\n- (void)seq:(int)x {\n  if (x == 1) {}\n  if (x == 2) {}\n  if (x == 3) {}\n}\n@end\n";
    const nested = "@implementation Bar\n- (void)nested:(int)x {\n  if (x == 1) {\n    if (x == 2) {\n      if (x == 3) {}\n    }\n  }\n}\n@end\n";
    const seqNode = (await parser.parse(fileInfo("a.m", seq))).nodes.find(n => n.type === "method");
    const nestedNode = (await parser.parse(fileInfo("b.m", nested))).nodes.find(n => n.type === "method");
    expect(seqNode?.complexity).toBe(nestedNode?.complexity);
    expect(seqNode?.cognitiveComplexity).toBe(3);
    expect(nestedNode?.cognitiveComplexity).toBe(6);
  });

  it("collapses a boolean-operator chain to +1", async () => {
    const src = "@implementation Foo\n- (void)bar:(int)x {\n  if (x > 0 && x < 10 && x != 5) {}\n}\n@end\n";
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.cognitiveComplexity).toBe(2);
  });

  it("counts a @try/@catch as a decision point", async () => {
    const src = "@implementation Foo\n- (void)bar {\n  @try {\n    int x = 1;\n  } @catch (NSException *e) {\n    int y = 0;\n  }\n}\n@end\n";
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.type === "method")?.cognitiveComplexity).toBe(1);
  });

  it("scores a self-recursive bare C function call as +1", async () => {
    const src = "int fact(int n) {\n  if (n <= 1) {\n    return 1;\n  }\n  return fact(n - 1) + n;\n}\n";
    const { nodes } = await parser.parse(fileInfo("a.m", src));
    expect(nodes.find(n => n.label === "fact")?.cognitiveComplexity).toBe(2);
  });
});
