import { describe, it, expect } from "vitest";
import {
  buildSimilaritySignature,
  estimateSimilarity,
  MIN_TOKENS_FOR_SIMILARITY,
  SIMILARITY_LANES,
} from "./similarity-signature.js";

// Small deterministic PRNG so results are reproducible across runs — a
// cyclic/repeating token vocabulary distorts the shingle-set size and gives
// misleading similarity numbers (discovered during this spec's own manual
// verification), so every fixture below uses pseudo-random content.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = ["if_statement", "ID", "LIT", "for_statement", "call_expression", "binary_expression", "return_statement", "while_statement"];

function randomTokens(n: number, seed: number): string[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]);
}

describe("buildSimilaritySignature", () => {
  it("returns null below MIN_TOKENS_FOR_SIMILARITY", () => {
    expect(buildSimilaritySignature(randomTokens(MIN_TOKENS_FOR_SIMILARITY - 1, 1))).toBeNull();
  });

  it("returns a signature at or above the floor", () => {
    expect(buildSimilaritySignature(randomTokens(MIN_TOKENS_FOR_SIMILARITY, 1))).not.toBeNull();
  });

  it("produces a fixed-width hex string of SIMILARITY_LANES * 4 characters", () => {
    const sig = buildSimilaritySignature(randomTokens(60, 1))!;
    expect(sig).toHaveLength(SIMILARITY_LANES * 4);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic — identical input always produces identical output", () => {
    const tokens = randomTokens(60, 1);
    expect(buildSimilaritySignature(tokens)).toBe(buildSimilaritySignature([...tokens]));
  });
});

describe("estimateSimilarity", () => {
  it("estimates 1 for identical token streams", () => {
    const tokens = randomTokens(60, 1);
    const sigA = buildSimilaritySignature(tokens)!;
    const sigB = buildSimilaritySignature([...tokens])!;
    expect(estimateSimilarity(sigA, sigB)).toBe(1);
  });

  it("estimates near 0 for two independently-random token streams", () => {
    const sigA = buildSimilaritySignature(randomTokens(200, 1))!;
    const sigB = buildSimilaritySignature(randomTokens(200, 999))!;
    expect(estimateSimilarity(sigA, sigB)).toBeLessThan(0.3);
  });

  it("estimates a high similarity for a stream with one token changed out of many", () => {
    const tokens = randomTokens(200, 1);
    const perturbed = [...tokens];
    perturbed[100] = "PERTURBED_TOKEN";
    const sigA = buildSimilaritySignature(tokens)!;
    const sigB = buildSimilaritySignature(perturbed)!;
    expect(estimateSimilarity(sigA, sigB)).toBeGreaterThan(0.8);
  });

  it("is symmetric", () => {
    const sigA = buildSimilaritySignature(randomTokens(60, 1))!;
    const sigB = buildSimilaritySignature(randomTokens(60, 2))!;
    expect(estimateSimilarity(sigA, sigB)).toBe(estimateSimilarity(sigB, sigA));
  });

  it("returns 0, never throws, for malformed or mismatched-length input", () => {
    const sig = buildSimilaritySignature(randomTokens(60, 1))!;
    expect(estimateSimilarity("garbage", sig)).toBe(0);
    expect(estimateSimilarity("", sig)).toBe(0);
    expect(estimateSimilarity("zzzz", "gggg")).toBe(0);
    expect(estimateSimilarity(sig, sig.slice(0, -4))).toBe(0);
  });
});
