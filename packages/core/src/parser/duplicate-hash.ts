import { createHash } from 'crypto';

/** Below this many normalized tokens, a body is too trivial to be a
 * meaningful duplication signal (would flood output with one-liner noise). */
export const MIN_TOKENS_FOR_DUPLICATE_HASH = 20;

export function hashTokens(tokens: string[]): string | null {
  if (tokens.length < MIN_TOKENS_FOR_DUPLICATE_HASH) return null;
  return createHash('sha256').update(tokens.join('|')).digest('hex');
}
