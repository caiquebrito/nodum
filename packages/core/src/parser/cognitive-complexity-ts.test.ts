import { describe, it, expect } from "vitest";
import ts from "typescript";
import { computeCognitiveComplexityTs } from "./cognitive-complexity-ts.js";

function bodyOf(src: string, funcName: string): ts.Block {
  const sourceFile = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  let found: ts.Block | undefined;

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText() === funcName && node.body) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!found) throw new Error(`function ${funcName} not found`);
  return found;
}

describe("computeCognitiveComplexityTs", () => {
  it("scores a function with no decision points as 0", () => {
    expect(computeCognitiveComplexityTs(bodyOf("function f() { return 1; }", "f"))).toBe(0);
  });

  it("costs 1 + depth for nested ifs", () => {
    const src = "function f(x) { if (x) { if (x) { if (x) { } } } }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "f"))).toBe(6);
  });

  it("costs 1 flat per sequential if at the top level", () => {
    const src = "function f(x) { if (x) { } if (x) { } if (x) { } }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "f"))).toBe(3);
  });

  it("matches the documented cyclomatic-4-vs-cognitive-3-or-6 case exactly", () => {
    const seq = "function seq(x) { if (x == 1) { } if (x == 2) { } if (x == 3) { } }";
    const nested = "function nested(x) { if (x == 1) { if (x == 2) { if (x == 3) { } } } }";
    expect(computeCognitiveComplexityTs(bodyOf(seq, "seq"))).toBe(3);
    expect(computeCognitiveComplexityTs(bodyOf(nested, "nested"))).toBe(6);
  });

  it("collapses a boolean-operator sequence to +1, not once per operator", () => {
    const src = "function f(a, b, c) { const x = a && b && c; }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "f"))).toBe(1);
  });

  it("scores a recursive call as +1 when selfName is given", () => {
    const src = "function fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "fact"), "fact")).toBe(2);
  });

  it("does not score a call to a different function as recursion", () => {
    const src = "function a() { return b(); }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "a"), "a")).toBe(0);
  });

  it("does not descend into a nested function declaration (a separately-scored boundary)", () => {
    const src = "function outer() { function inner() { if (true) { } if (true) { } } return inner; }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "outer"))).toBe(0);
  });

  it("descends into an arrow function's body, rolling its branches into the enclosing function", () => {
    const src = "function outer() { const fn = () => { if (true) { } }; fn(); }";
    expect(computeCognitiveComplexityTs(bodyOf(src, "outer"))).toBe(2); // if at depth 1 (1+1), inside the arrow at depth 0
  });
});
