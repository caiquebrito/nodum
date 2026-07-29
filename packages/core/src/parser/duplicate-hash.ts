import { createHash } from 'crypto';
import { buildSimilaritySignature } from './similarity-signature.js';

/** Below this many normalized tokens, a body is too trivial to be a
 * meaningful duplication signal (would flood output with one-liner noise). */
export const MIN_TOKENS_FOR_DUPLICATE_HASH = 20;

export function hashTokens(tokens: string[]): string | null {
  if (tokens.length < MIN_TOKENS_FOR_DUPLICATE_HASH) return null;
  return createHash('sha256').update(tokens.join('|')).digest('hex');
}

export interface DuplicateSignals {
  duplicateHash?: string;
  similaritySignature?: string;
}

/**
 * Both duplication signals derived from one normalized token stream (spec
 * 048) — the existing exact `duplicateHash` (unchanged, `hashTokens`
 * itself is untouched) plus the new fuzzy `similaritySignature`. A body
 * can clear one floor, both, or neither: `similaritySignature`'s floor
 * (`MIN_TOKENS_FOR_SIMILARITY`) is strictly higher than `duplicateHash`'s,
 * so a short-but-not-trivial body can have an exact hash with no fuzzy
 * signature. Spread directly into a `Node` literal at each parser's
 * node-creation call site — same shape as every other parser field here.
 */
export function buildDuplicateSignals(tokens: string[]): DuplicateSignals {
  const duplicateHash = hashTokens(tokens);
  const similaritySignature = buildSimilaritySignature(tokens);
  return {
    ...(duplicateHash ? { duplicateHash } : {}),
    ...(similaritySignature ? { similaritySignature } : {}),
  };
}
