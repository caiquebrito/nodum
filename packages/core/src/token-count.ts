/**
 * Approximate token counting for MCP context payloads.
 *
 * Claude's real tokenizer isn't public, so this uses OpenAI's o200k_base BPE
 * encoding (via js-tiktoken) as a stand-in. It's close enough to catch
 * order-of-magnitude regressions and compare before/after context sizes —
 * but it is NOT an exact match for what Claude actually counts. Every count
 * this module produces is named `approxTokens` everywhere it's surfaced,
 * never `tokens` — see spec 024.
 *
 * Imported from the package's top-level entry point rather than its
 * `js-tiktoken/ranks/o200k_base` subpath: the subpath form would only load
 * that one rank table (smaller), but this repo's `tsconfig.json` uses
 * `moduleResolution: "node"`, which doesn't resolve package.json `exports`
 * subpath maps — repo-wide resolution mode is out of scope for this spec.
 */
import { Tiktoken, getEncoding } from 'js-tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding('o200k_base');
  }
  return encoder;
}

/**
 * Approximate token count for a string. Offline, synchronous, no network
 * call. Returns 0 for empty input rather than invoking the encoder.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}
