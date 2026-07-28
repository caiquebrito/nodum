import { describe, it, expect } from "vitest";
import { countCyclomaticComplexity } from "./complexity-text.js";

describe("countCyclomaticComplexity", () => {
  it("returns 1 for a body with no decision points", () => {
    expect(countCyclomaticComplexity("{ return 1; }")).toBe(1);
  });

  it("counts an if statement", () => {
    expect(countCyclomaticComplexity("{ if (x) { return 1; } return 2; }")).toBe(2);
  });

  it("counts if/else-if as one decision point per if", () => {
    const body = "{ if (x) { a(); } else if (y) { b(); } else { c(); } }";
    expect(countCyclomaticComplexity(body)).toBe(3); // 1 base + if + else-if's embedded if
  });

  it("counts for/while/catch/case", () => {
    const body = "{ for (;;) {} while (x) {} try {} catch (e) {} switch (x) { case 1: break; case 2: break; } }";
    expect(countCyclomaticComplexity(body)).toBe(1 + 1 + 1 + 1 + 2);
  });

  it("counts && and || occurrences", () => {
    expect(countCyclomaticComplexity("{ if (a && b || c) {} }")).toBe(1 + 1 + 1 + 1);
  });

  it("does not count ternary (?:)", () => {
    expect(countCyclomaticComplexity("{ return a ? b : c; }")).toBe(1);
  });
});
