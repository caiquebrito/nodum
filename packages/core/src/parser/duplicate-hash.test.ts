import { describe, it, expect } from "vitest";
import { hashTokens, MIN_TOKENS_FOR_DUPLICATE_HASH } from "./duplicate-hash.js";

describe("hashTokens", () => {
  it("returns null when below the minimum token threshold", () => {
    const tokens = Array(MIN_TOKENS_FOR_DUPLICATE_HASH - 1).fill("ID");
    expect(hashTokens(tokens)).toBeNull();
  });

  it("returns a hash at exactly the minimum token threshold", () => {
    const tokens = Array(MIN_TOKENS_FOR_DUPLICATE_HASH).fill("ID");
    expect(hashTokens(tokens)).not.toBeNull();
  });

  it("is deterministic — same tokens produce the same hash", () => {
    const tokens = Array(MIN_TOKENS_FOR_DUPLICATE_HASH).fill("ID");
    expect(hashTokens(tokens)).toBe(hashTokens([...tokens]));
  });

  it("produces different hashes for different token sequences", () => {
    const a = Array(MIN_TOKENS_FOR_DUPLICATE_HASH).fill("ID");
    const b = [...a.slice(1), "LIT"];
    expect(hashTokens(a)).not.toBe(hashTokens(b));
  });
});
