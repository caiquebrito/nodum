import { describe, it, expect } from "vitest";
import { extractBraceBody } from "./brace-body.js";

function lines(text: string): string[] {
  return text.split("\n");
}

describe("extractBraceBody", () => {
  it("extracts a body whose opening brace is on the same line", () => {
    const body = extractBraceBody(lines("function foo() {\n  return 1;\n}"), 0);
    expect(body).toBe("function foo() {\n  return 1;\n}");
  });

  it("extracts a body whose opening brace is on a later line (Allman style)", () => {
    const body = extractBraceBody(lines("function foo()\n{\n  return 1;\n}"), 0);
    expect(body).toContain("return 1;");
  });

  it("does not miscount a brace inside a string literal", () => {
    const body = extractBraceBody(lines('function foo() {\n  const s = "{ not a brace }";\n  return s;\n}'), 0);
    expect(body).toContain('return s;');
    expect(body?.trim().endsWith("}")).toBe(true);
  });

  it("returns null for a brace-less single-expression body with no brace within the lookahead window", () => {
    const body = extractBraceBody(lines("const foo = () => 1;\nconst x = 2;\nconst y = 3;\nconst z = 4;"), 0);
    expect(body).toBeNull();
  });

  it("returns null for an unterminated body", () => {
    const body = extractBraceBody(lines("function foo() {\n  return 1;"), 0);
    expect(body).toBeNull();
  });

  it("ignores a brace after a line comment", () => {
    const body = extractBraceBody(lines("function foo() { // comment with { brace\n  return 1;\n}"), 0);
    expect(body).toContain("return 1;");
  });
});
