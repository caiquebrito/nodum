import { describe, it, expect } from "vitest";
import { normalizeBodyTokens } from "./normalize-body-text.js";

describe("normalizeBodyTokens", () => {
  it("replaces identifiers with ID", () => {
    expect(normalizeBodyTokens("myVariable")).toEqual(["ID"]);
  });

  it("replaces string literals with LIT", () => {
    expect(normalizeBodyTokens(`"hello" 'world' \`template\``)).toEqual(["LIT", "LIT", "LIT"]);
  });

  it("replaces numeric literals with LIT", () => {
    expect(normalizeBodyTokens("42 3.14")).toEqual(["LIT", "LIT"]);
  });

  it("preserves keywords", () => {
    expect(normalizeBodyTokens("if (x) { return y; }")).toEqual([
      "if", "(", "ID", ")", "{", "return", "ID", ";", "}",
    ]);
  });

  it("tokenizes punctuation as individual tokens regardless of spacing", () => {
    expect(normalizeBodyTokens("if(x>0){")).toEqual(["if", "(", "ID", ">", "LIT", ")", "{"]);
  });

  it("produces identical token streams for renamed-but-structurally-identical code", () => {
    const a = normalizeBodyTokens("if (foo > 0) { return bar; }");
    const b = normalizeBodyTokens("if (baz > 0) { return qux; }");
    expect(a).toEqual(b);
  });
});
