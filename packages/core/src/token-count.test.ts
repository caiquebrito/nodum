import { describe, it, expect } from 'vitest';
import { countTokens } from './token-count.js';

describe('countTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns a stable count for the same input across calls', () => {
    const text = 'export function buildSmartContext(query, graph, maxNodes) { return graph; }';
    const first = countTokens(text);
    const second = countTokens(text);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
  });

  it('returns a larger count for longer text', () => {
    const short = 'const x = 1;';
    const long = 'const x = 1;\n'.repeat(50);
    expect(countTokens(long)).toBeGreaterThan(countTokens(short));
  });

  it('does not throw on non-ASCII input', () => {
    expect(() => countTokens('função checkLatestVersion — 中文 emoji 🚀')).not.toThrow();
    expect(countTokens('função checkLatestVersion — 中文 emoji 🚀')).toBeGreaterThan(0);
  });
});
