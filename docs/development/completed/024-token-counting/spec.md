# 024 — Approximate token counting for MCP context payloads

## Status: done

Implemented and tested (4 new `packages/core/src/token-count.test.ts` cases; full workspace
suite — 191 core, 95 cli, 15 mcp, 291 total — green). Real check: built `dist/token-count.js`
and ran it directly against a representative context-payload string — `countTokens()` returned
36, a hand-estimate by word count (× ~1.3) gave ~38 — same order of magnitude, as expected from a
stand-in tokenizer. MCP response bodies are unchanged; `buildSmartContext()`'s new
`{ text, approxTokens }` return shape only required updating its one call site in
`handlers.ts:handleSearch`.

## Goal

Give every MCP context payload a real, computed number attached to it. Today
`buildSmartContext()` (`packages/mcp/src/smart-context.ts`) tells Claude "40-60% fewer tokens"
and, on a cache hit, "83% more reduction" — both are string literals baked into the response
text, unconnected to anything measured. `estimateTokenSavings()` (`smart-context.ts:411`) already
exists to compute a real percentage from two counts, but nothing in the codebase ever calls it,
because nothing in the codebase can produce a token count in the first place. This spec adds the
one missing primitive — `countTokens(text): number` — and wires it into the context path as pure
instrumentation. It does not change scoring, formatting, or the hardcoded strings yet; that's
026, once this spec's numbers exist to replace them with.

## Why now

First of the batch that touches source rather than docs/config, and everything else in v2.2.0
depends on it: 025 logs the numbers this spec produces, 026 deletes the hardcoded percentages
using them as the real baseline, and 027's acceptance criterion is literally "quote the
before/after count" — none of that is possible without a working counter.

## Scope

- New dependency: `js-tiktoken` in `packages/core`, via its top-level `getEncoding("o200k_base")`
  entry point. The leaner `js-tiktoken/ranks/o200k_base` subpath (loading only the one ~2.2MB
  rank table instead of all five bundled into the ~5MB top-level module) was tried first but
  doesn't resolve under this repo's `tsconfig.json` (`moduleResolution: "node"`, which predates
  package.json `exports` subpath maps) — see "Bugs found during real implementation" below.
  Fully offline either way, no network call, no native binary — a plain BPE table + a JS encoder,
  consistent with "100% local" being nodum's stated differentiator (`README.md`'s FAQ; also the
  standard this project already held itself to for embeddings — see spec 001).
- `packages/core/src/token-count.ts` (new): `countTokens(text: string): number`, memoizing the
  `Tiktoken` instance the same way `packages/mcp/src/embeddings.ts` memoizes its feature-extractor
  pipeline (module-level lazy singleton, not re-constructed per call — building a `Tiktoken` means
  parsing the whole rank table, and every context-building call would otherwise pay that cost
  again).
- Exported from `packages/core/src/index.ts` alongside the other analyzer-style exports, so
  `packages/mcp` (and, later, the benchmark suite in 028) can import it as a published API rather
  than reaching into `core`'s internals.
- Instrument, don't change: `buildSmartContext()` calls `countTokens()` on its own returned string
  right before returning, and includes the number in the object it hands back — see Design for
  why the return type has to grow from `string` to a small wrapper rather than staying a bare
  string.
- **Name the field for what it is.** `approxTokens`, not `tokens` — this is a stand-in tokenizer,
  not Claude's real one (which isn't public), and the entire premise of v2.2.0 is to stop
  asserting precision the codebase doesn't have. Every doc comment, log field, and MCP response
  key introduced by this spec uses `approxTokens`.

## Out of scope

- Changing `buildSmartContext()`'s scoring, expansion, or formatting logic — purely additive
  instrumentation. 027 is where the actual expansion-cap fix happens, once this spec makes it
  possible to measure whether that fix helped.
- Removing the hardcoded percentage strings from the response text — 026's job specifically, so
  that the deletion lands as its own reviewable, revertable change rather than being buried in
  the plumbing change here.
- Counting tokens anywhere outside the MCP context path (CLI output, `graph.json` on disk,
  `SUMMARY.md`) — those aren't consumed by an LLM today, so there's nothing to measure yet.
- Matching Claude's real tokenizer exactly. `o200k_base` is OpenAI's newest public encoding and a
  reasonable approximation for "how expensive is this text to a modern LLM," but it is not what
  Claude actually counts. Nothing in this spec claims otherwise — see the field-naming decision
  above.

## Design

### 1. `packages/core/package.json`

```diff
   "dependencies": {
     "ignore": "^5.3.0",
+    "js-tiktoken": "^1.0.21",
     "typescript": "^5.3.0"
   },
```

### 2. `packages/core/src/token-count.ts` (new)

```ts
/**
 * Approximate token counting for MCP context payloads.
 *
 * Claude's real tokenizer isn't public, so this uses OpenAI's o200k_base BPE
 * encoding (via js-tiktoken) as a stand-in. It's close enough to catch
 * order-of-magnitude regressions and compare before/after context sizes —
 * but it is NOT an exact match for what Claude actually counts. Every count
 * this module produces is named `approxTokens` everywhere it's surfaced,
 * never `tokens` — see spec 024.
 */
import { Tiktoken, getEncoding } from "js-tiktoken";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding("o200k_base");
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
```

### 3. `packages/core/src/index.ts`

```diff
+export { countTokens } from './token-count.js';
```

### 4. `packages/mcp/src/smart-context.ts`

`buildSmartContext()`'s return type grows from `Promise<string>` to a small result object, so the
count travels with the text instead of requiring every caller to re-derive it:

```ts
export interface SmartContextResult {
  text: string;
  approxTokens: number;
}

export async function buildSmartContext(
  query: string,
  graph: Graph,
  maxNodes: number = 25,
  cache?: ConversationCache
): Promise<SmartContextResult> {
  // ...unchanged body...
  const responseText = /* existing constructed string, unchanged */;
  return { text: responseText, approxTokens: countTokens(responseText) };
}
```

The two early-return paths (`keywords.length === 0`, `relevant.length === 0`) get the same
treatment — wrap their string in `{ text, approxTokens: countTokens(text) }` — so the return type
is consistent on every path, not just the main one. Implemented as a shared `withTokenCount(text)`
helper next to the three return points rather than repeating the object literal.

## Bugs found during real implementation

- **`js-tiktoken/ranks/o200k_base` doesn't resolve.** `tsc` failed with `TS2307` — the repo's root
  `tsconfig.json` sets `moduleResolution: "node"` (classic, pre-`exports`-map resolution), so
  subpath exports like `js-tiktoken/ranks/o200k_base` aren't resolvable even though the file
  exists on disk. Fixing this the "right" way (`moduleResolution: "node16"` or `"bundler"`) is a
  repo-wide change with its own blast radius, out of scope for a spec about adding one counting
  function. Used the top-level `js-tiktoken` entry point (`getEncoding("o200k_base")`) instead —
  functionally identical, ships all five bundled rank tables instead of one, acceptable given
  `js-tiktoken` is a `dependencies` entry resolved by npm at install time, not something this
  repo's own tarball bundles.

### 5. `packages/mcp/src/handlers.ts`

Every call site that currently does `const contextText = await buildSmartContext(...)` and hands
`contextText` straight to the MCP response unwraps the new shape: `const { text, approxTokens } =
await buildSmartContext(...)`. The MCP tool response keeps returning `text` as its content, with
`approxTokens` available for 025's logging and 026's real-savings calculation — not yet exposed to
Claude in the response body itself (026's job, deliberately deferred so this spec stays pure
plumbing).

## Acceptance criteria

- [x] `countTokens("")` returns `0` without constructing the encoder.
- [x] `countTokens(text)` returns a stable, deterministic integer for the same input across
      calls (encoder is memoized, not rebuilt).
- [x] `buildSmartContext()` returns `{ text, approxTokens }` on every code path (empty keywords,
      no matching nodes, and the normal path).
- [x] MCP output text is byte-identical to before this spec — the response body itself is
      unchanged; only the plumbing around it grows a number.
- [x] `countTokens` is exported from `@caiquebrito/nodum-core`'s public API.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/token-count.test.ts` (new) — empty string returns 0 without invoking the
encoder; same input returns the same count across repeated calls; a longer string returns a
larger count than a shorter one (monotonic, without asserting an exact magic number that would
just be pinned to the current encoding's internals); non-ASCII input doesn't throw.

`packages/mcp/src/smart-context.test.ts` — this spec doesn't add new scoring behavior to test,
but every existing manual/integration check of `buildSmartContext()`'s return value needs its
call sites updated for the new `{ text, approxTokens }` shape (real test coverage for
`smart-context.ts` itself is spec 029's job — this file currently doesn't exist).

## Success Metrics

- Real check: sync this repo, call `search_graph` through the MCP server for a query with a
  known, moderately-sized result set, and confirm `approxTokens` is a plausible integer in the
  same order of magnitude as counting the response by hand (words × ~1.3).

## Related

Blocks: 025 (logs `approxTokens`), 026 (replaces hardcoded percentages with a real
`estimateTokenSavings()` call using this count), 027 (acceptance criterion is a before/after
`approxTokens` number), 028 (benchmark harness's offline suite counts tokens the same way).
