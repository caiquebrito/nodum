import { describe, it, expect } from "vitest";
import { hashTokens, buildDuplicateSignals, MIN_TOKENS_FOR_DUPLICATE_HASH } from "./duplicate-hash.js";
import { MIN_TOKENS_FOR_SIMILARITY } from "./similarity-signature.js";

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

describe("buildDuplicateSignals (spec 048)", () => {
  it("sets neither field below duplicateHash's floor", () => {
    const tokens = Array(MIN_TOKENS_FOR_DUPLICATE_HASH - 1).fill("ID");
    expect(buildDuplicateSignals(tokens)).toEqual({});
  });

  it("sets only duplicateHash in the band between the two floors", () => {
    expect(MIN_TOKENS_FOR_SIMILARITY).toBeGreaterThan(MIN_TOKENS_FOR_DUPLICATE_HASH);
    const tokens = Array(MIN_TOKENS_FOR_DUPLICATE_HASH).fill("ID");
    const signals = buildDuplicateSignals(tokens);
    expect(signals.duplicateHash).toBeDefined();
    expect(signals.similaritySignature).toBeUndefined();
  });

  it("sets both fields at or above similaritySignature's higher floor", () => {
    const tokens = Array(MIN_TOKENS_FOR_SIMILARITY).fill("ID");
    const signals = buildDuplicateSignals(tokens);
    expect(signals.duplicateHash).toBeDefined();
    expect(signals.similaritySignature).toBeDefined();
  });

  it("duplicateHash matches what hashTokens alone would produce", () => {
    const tokens = Array(MIN_TOKENS_FOR_SIMILARITY).fill("ID");
    expect(buildDuplicateSignals(tokens).duplicateHash).toBe(hashTokens(tokens));
  });
});
