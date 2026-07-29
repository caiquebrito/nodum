import { describe, it, expect } from "vitest";
import { computeCognitiveComplexity, type CognitiveConfig } from "./cognitive-complexity.js";
import { loadGrammar, getQuery, type TSNode } from "./treesitter/engine.js";

// Drives the shared walker against real Python trees (any TSNode-based
// grammar works — Python is chosen for having a real, distinct `elif_clause`
// node type, which exercises the walker's `nesting` set generically without
// needing any Python-specific logic in the walker itself).
const PYTHON_CONFIG: CognitiveConfig = {
  nesting: new Set(["if_statement", "elif_clause", "for_statement", "while_statement", "except_clause"]),
  nestingOnly: new Set(["lambda"]),
  boundary: new Set(["function_definition"]),
  isBooleanOp: node => node.type === "boolean_operator",
  calleeName: node =>
    node.type === "call" && node.childForFieldName("function")?.type === "identifier"
      ? (node.childForFieldName("function") as TSNode).text
      : null,
};

async function bodyOf(src: string, funcName: string): Promise<TSNode> {
  const { parser, language } = await loadGrammar("tree-sitter-python.wasm");
  const tree = parser.parse(src);
  const root = tree!.rootNode;
  const query = getQuery(language, "cc-test-functions", "(function_definition name: (identifier) @name) @def");
  for (const match of query.matches(root)) {
    const name = match.captures.find(c => c.name === "name")?.node.text;
    if (name !== funcName) continue;
    const def = match.captures.find(c => c.name === "def")!.node;
    const body = def.childForFieldName("body")!;
    return body;
  }
  throw new Error(`function ${funcName} not found`);
}

describe("computeCognitiveComplexity", () => {
  it("scores a function with no decision points as 0 (not cyclomatic's baseline of 1)", async () => {
    const body = await bodyOf("def f():\n    return 1\n", "f");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(0);
  });

  it("costs 1 + depth for a nesting construct at each level", async () => {
    const src = "def f(x):\n    if x:\n        if x:\n            if x:\n                pass\n";
    const body = await bodyOf(src, "f");
    // depth 0: 1+0=1, depth 1: 1+1=2, depth 2: 1+2=3 -> total 6
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(6);
  });

  it("costs 1 flat per sequential (non-nested) construct at the top level", async () => {
    const src = "def f(x):\n    if x:\n        pass\n    if x:\n        pass\n    if x:\n        pass\n";
    const body = await bodyOf(src, "f");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(3); // three independent depth-0 ifs
  });

  it("matches the documented cyclomatic-4-vs-cognitive-3-or-6 case exactly", async () => {
    const seq = "def seq(x):\n    if x == 1:\n        pass\n    if x == 2:\n        pass\n    if x == 3:\n        pass\n";
    const nested = "def nested(x):\n    if x == 1:\n        if x == 2:\n            if x == 3:\n                pass\n";
    expect(computeCognitiveComplexity(await bodyOf(seq, "seq"), PYTHON_CONFIG)).toBe(3);
    expect(computeCognitiveComplexity(await bodyOf(nested, "nested"), PYTHON_CONFIG)).toBe(6);
  });

  it("collapses a boolean-operator sequence to +1, not once per operator", async () => {
    const src = "def f(a, b, c):\n    x = a and b and c\n";
    const body = await bodyOf(src, "f");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(1);
  });

  it("does not increment nesting depth for a boolean-operator sequence's own descendants", async () => {
    const src = "def f(a, b, c):\n    if a and b:\n        pass\n";
    const body = await bodyOf(src, "f");
    // the if costs 1 (depth 0); the boolean sequence inside its condition
    // costs a flat 1, not 1+1 — booleans don't carry a depth bonus.
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(2);
  });

  it("scores a recursive call as +1 when selfName is given", async () => {
    const src = "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n";
    const body = await bodyOf(src, "fact");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG, "fact")).toBe(2); // if (1) + recursion (1)
  });

  it("does not score a call to a different function as recursion", async () => {
    const src = "def a():\n    return b()\n";
    const body = await bodyOf(src, "a");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG, "a")).toBe(0);
  });

  it("does not descend into a nested function_definition (a separately-scored boundary)", async () => {
    const src = "def outer():\n    def inner():\n        if True:\n            pass\n        if True:\n            pass\n    return inner\n";
    const body = await bodyOf(src, "outer");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(0);
  });

  it("a lambda itself contributes nothing to complexity (nestingOnly, not nesting)", async () => {
    const src = "def f(x):\n    g = lambda y: y\n    if x:\n        pass\n";
    const body = await bodyOf(src, "f");
    expect(computeCognitiveComplexity(body, PYTHON_CONFIG)).toBe(1); // the if, at depth 0 — lambda itself contributes 0
  });
});
