/**
 * MinHash-style structural similarity signature for near-duplicate
 * detection (spec 048) — built from the same normalized token stream every
 * parser's `collectNormalizedTokens` already produces for `duplicateHash`
 * (`ID`/`LIT`/grammar-node-type-name), so no parser needed to change what
 * it returns. See `duplicate-hash.ts`'s `buildDuplicateSignals` for how
 * this composes with the existing exact-hash signal, and
 * `analyzer/similar-code.ts` for how the two are combined at query time.
 *
 * Algorithm: k-gram shingling over the token stream, MinHash estimation of
 * Jaccard similarity between shingle sets. Deliberately hand-rolled, no new
 * dependency — `crypto.createHash` was measured (not assumed) to be ~4.4x
 * slower than a hand-rolled FNV-1a for this workload (5M synthetic
 * per-shingle hashes: 1.75s vs. 396ms), a real cost at the scale of a large
 * real project's full sync — see spec 048's Design for the benchmark.
 */

/** k-gram width over the normalized token stream. */
export const SIMILARITY_KGRAM = 5;

/**
 * MinHash lanes. The estimator's standard error at a true Jaccard of 0.8 is
 * ~sqrt(0.8*0.2/32) ≈ 0.071 — noisy enough that a borderline pair can read
 * on either side of a threshold by chance. Kept at 32 (not 64) after
 * real-corpus calibration found no false positives), doubling this
 * quarters the estimator's variance at 2x the on-disk cost, and is a live
 * knob if a project's real usage needs it. Kept as its own named
 * constant, not inlined, specifically so raising it is a one-line change
 * (see spec 048's Design escalation path).
 */
export const SIMILARITY_LANES = 32;

/**
 * Minimum normalized tokens before a signature is computed — deliberately
 * higher than `duplicateHash`'s `MIN_TOKENS_FOR_DUPLICATE_HASH` (20). A
 * short body's shingle set is small enough that a MinHash estimate over it
 * is unreliable and the ~40-150-symbol normalized-token vocabulary (varies
 * by language — see spec 048's Design) makes small unrelated functions
 * genuinely likely to collide. Calibrated against real-project corpora —
 * see spec 048's Success Metrics for the precision table this value is
 * justified by.
 */
export const MIN_TOKENS_FOR_SIMILARITY = 40;

const LANE_BITS = 16;
const LANE_HEX_CHARS = LANE_BITS / 4;

/** FNV-1a, 32-bit. Pure arithmetic, no allocation — see the module-level benchmark note. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Per-lane multiplier/offset, derived deterministically from a fixed seed
 * via FNV-1a chains over the lane index — avoids hand-writing a table of
 * `SIMILARITY_LANES` magic constants while staying fully reproducible
 * across versions (same lane `j` always derives the same `A[j]`/`B[j]`).
 */
const LANE_MULTIPLIERS: number[] = Array.from({ length: SIMILARITY_LANES }, (_, j) => fnv1a(`similarity-lane-a:${j}`) | 1);
const LANE_OFFSETS: number[] = Array.from({ length: SIMILARITY_LANES }, (_, j) => fnv1a(`similarity-lane-b:${j}`));

/**
 * Builds a fixed-width hex-encoded MinHash signature from a normalized
 * token stream, or `null` if the stream is too short to trust (see
 * `MIN_TOKENS_FOR_SIMILARITY`). Encoded as `SIMILARITY_LANES` hex groups
 * of `LANE_HEX_CHARS` characters each — a plain hex string, not a
 * `number[]`, specifically to bound `graph.json`'s on-disk size: pretty-
 * printed JSON puts every array element on its own indented line, making a
 * raw array cost roughly 3x what one concatenated string costs for the
 * same information (see spec 048's Design).
 *
 * Each lane keeps the minimum of `(A[j] * shingleHash + B[j]) mod 2^32`
 * over every distinct shingle, per the standard MinHash construction —
 * equal minima always agree; truncating each lane's minimum to its top 16
 * bits (after computing the min, not before) roughly halves the signature
 * size at the cost of an additional ~2^-16 per-lane false-agreement rate,
 * negligible against a 32-lane average and verified not to shift real
 * similarity estimates during this spec's own corpus calibration.
 */
export function buildSimilaritySignature(tokens: string[]): string | null {
  if (tokens.length < MIN_TOKENS_FOR_SIMILARITY) return null;

  // Joined with no separator relying on token-boundary ambiguity being
  // harmless here: every token is drawn from a small closed vocabulary
  // ('ID'/'LIT'/grammar node-type names), so an occasional shingle-string
  // collision across different token sequences only nudges the similarity
  // estimate, never breaks correctness.
  const shingles = new Set<string>();
  for (let i = 0; i + SIMILARITY_KGRAM <= tokens.length; i++) {
    shingles.add(tokens.slice(i, i + SIMILARITY_KGRAM).join(''));
  }
  if (shingles.size === 0) return null;

  const mins = new Array<number>(SIMILARITY_LANES).fill(0xffffffff);
  for (const shingle of shingles) {
    const h = fnv1a(shingle);
    for (let lane = 0; lane < SIMILARITY_LANES; lane++) {
      const permuted = (Math.imul(LANE_MULTIPLIERS[lane], h) + LANE_OFFSETS[lane]) >>> 0;
      if (permuted < mins[lane]) mins[lane] = permuted;
    }
  }

  let out = '';
  for (let lane = 0; lane < SIMILARITY_LANES; lane++) {
    out += (mins[lane] >>> 16).toString(16).padStart(LANE_HEX_CHARS, '0');
  }
  return out;
}

function decodeSimilaritySignature(sig: string): number[] | null {
  if (sig.length !== SIMILARITY_LANES * LANE_HEX_CHARS) return null;
  const lanes: number[] = [];
  for (let lane = 0; lane < SIMILARITY_LANES; lane++) {
    const chunk = sig.slice(lane * LANE_HEX_CHARS, (lane + 1) * LANE_HEX_CHARS);
    const value = parseInt(chunk, 16);
    if (Number.isNaN(value)) return null;
    lanes.push(value);
  }
  return lanes;
}

/**
 * Fraction of agreeing MinHash lanes between two signatures — an unbiased
 * estimator of the Jaccard similarity between their underlying shingle
 * sets. Returns 0 (never throws) for malformed or mismatched-shape input.
 */
export function estimateSimilarity(a: string, b: string): number {
  const lanesA = decodeSimilaritySignature(a);
  const lanesB = decodeSimilaritySignature(b);
  if (!lanesA || !lanesB) return 0;

  let agree = 0;
  for (let lane = 0; lane < SIMILARITY_LANES; lane++) {
    if (lanesA[lane] === lanesB[lane]) agree++;
  }
  return agree / SIMILARITY_LANES;
}
