# 001 — Fix embeddings provider (local model, no API key)

## Status: done (2026-07-27) — verified via `npm test --workspace=@caiquebrito/nodum-mcp`, 4/4 passing

## Goal

Replace the broken embeddings implementation in `packages/mcp/src/embeddings.ts` with a real, working one, using a **local** embedding model — no cloud API, no API key — consistent with nodum's "no cloud, no API keys, no subscriptions" positioning (README.md:3).

## Why now

This isn't a v2.1.0 roadmap item, but it blocks trust in the rest of the plan: v2.0.0's CHANGELOG and README both claim "Semantic search with embeddings — 20% better node selection," and that claim is currently false. `embeddings.ts` calls:

```ts
const response = await (client as any).embeddings.create({
  model: "text-embedding-3-small",
  input: text,
  dimensions: 256,
});
```

`client` is an `Anthropic` instance (`@anthropic-ai/sdk`) — the Anthropic API has no embeddings endpoint. `text-embedding-3-small` is an OpenAI model name. The `as any` cast exists only to suppress the type error from calling a method that doesn't exist on the client. Every call throws, is swallowed by a `catch`, and returns `[]` — so `hasEmbeddings()` always sees empty embeddings, `smart-context.ts` always falls back to keyword-only search, and the "🧠 semantic" indicator in its output (`smart-context.ts:335`) never fires. This should be fixed before any later spec builds new features on top of a codebase that silently misrepresents its own capabilities.

## Scope

- `packages/mcp/src/embeddings.ts` — replace the OpenAI-shaped calls with a local embedding pipeline.
- `packages/mcp/package.json` — add `@xenova/transformers` as a dependency.
- New: `packages/mcp/src/embeddings.test.ts` (and enable real `vitest run` — see Test plan).
- Update `README.md` / `CHANGELOG.md` semantic-search claims only if their current wording turns out to overstate what ships here (see Acceptance criteria).

## Out of scope

- Changing `semantic-search.ts`'s scoring/merge logic (`cosineSimilarity`, `mergeScores`, etc.) — it's dimension-agnostic and doesn't need to change.
- Re-embedding already-synced graphs automatically (existing `graph.json` files with `embedding: []` just get regenerated on next `nodum sync`, same as today).
- Building a model-selection/config system — one fixed model for now.

## Design

**Model:** [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [`@xenova/transformers`](https://www.npmjs.com/package/@xenova/transformers) — a widely-used, small (~90MB, quantized ~23MB) sentence-embedding model that runs in pure JS/WASM, no native build step, no GPU required. Output: 384-dim vectors, mean-pooled + L2-normalized (matches what the pipeline's `{ pooling: "mean", normalize: true }` options produce).

**Lazy singleton pipeline** — loading the model has real latency/memory cost, so it must not run at MCP server startup or on every embed call:

```ts
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractorPromise;
}
```

**Embedding a string:**

```ts
async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
```

`generateNodeEmbedding`, `generateQueryEmbedding`, `generateQueryEmbeddings` all route through `embed()` instead of the removed `(client as any).embeddings.create(...)` calls. Drop the now-unused `Anthropic` client import and the `dimensions: 256` option (MiniLM's native output is 384-dim; we do not truncate it — truncating a non-Matryoshka model's embedding is not a valid dimensionality-reduction technique and would degrade quality for no benefit).

**Error handling stays the same shape** — `try/catch` around each embed call, `console.warn` + return `[]` on failure — so `hasEmbeddings()`'s existing 50%-threshold fallback logic in `smart-context.ts` continues to work unchanged as the safety net for e.g. a corrupted model cache.

**First-run behavior:** the first `embed()` call in a fresh environment downloads the model to the OS-level `transformers.js` cache directory (`~/.cache/huggingface/hub` by default) — one-time network access, then fully offline. This is a real behavior change from "no network ever" and must be called out in the module's top-of-file doc comment and in the relevant docs (see Acceptance criteria) rather than left implicit.

**Module doc comment update** (`embeddings.ts:1-5`) — replace the current "Uses Anthropic's text-embedding-3-small model" comment (wrong on two counts: wrong provider, wrong model) with an accurate description of the local model and its one-time download.

## Acceptance criteria

- [x] `embeddings.ts` no longer imports or constructs an `Anthropic` client.
- [x] `generateGraphEmbeddings`, `generateQueryEmbedding`, `generateQueryEmbeddings`, `hasEmbeddings` all keep their existing exported signatures (no breaking change to `smart-context.ts` or `handlers.ts` call sites).
- [x] A real embedding round-trip works: embedding two similar strings (e.g. `"login handler"` / `"login function"`) yields a materially higher `cosineSimilarity` than two unrelated strings (e.g. `"login handler"` / `"database migration"`).
- [x] `packages/mcp/package.json` declares `@xenova/transformers` as a dependency (no `as any` casts anywhere in the file).
- [x] Module doc comment and any README/CHANGELOG lines that assert "Anthropic" or "OpenAI" embeddings are corrected to describe the local model.
- [x] `packages/mcp/package.json` gets a `"test": "vitest run"` script (currently has none at all).
- [x] Root `vitest.config.ts` / workspace test scripts changed from watch-mode `vitest` to `vitest run` so `npm test` terminates in CI (this fixes the footgun for every package, not just mcp, since it's a repo-wide issue noted during research — flagging it here since this is the first spec to actually add a test file).

## Test plan

`packages/mcp/src/embeddings.test.ts`, using `vitest`. The real `@xenova/transformers` model must **not** be downloaded during tests (slow, network-dependent, breaks CI) — mock the module:

```ts
vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn(async (text: string) => ({
      data: new Float32Array(deterministicFakeVectorFrom(text)), // e.g. hash-based, same input → same output
    }))
  ),
}));
```

Cases:
- `generateNodeEmbedding`-equivalent path returns a non-empty vector for a normal node.
- `hasEmbeddings` returns `false` on an all-empty-embeddings node list and `true` once ≥50% of non-file nodes have a populated embedding (mirrors existing logic in `hasEmbeddings`, just exercised against the new implementation).
- A simulated pipeline failure (mock rejects) is caught and results in `[]`, not a thrown error — verifies the safety net still works.
- `generateGraphEmbeddings` skips nodes that already have an `embedding` and skips `type === "file"` nodes (existing behavior, `embeddings.ts:48`) — regression-guard this since it's easy to break while rewriting the function body.

## Success Metrics

- `hasEmbeddings()` can return `true` on a real synced project (currently: never, because the call always throws).
- Zero references to `text-embedding-3-small` or OpenAI anywhere in `packages/mcp/src`.
- `npx vitest run` passes repo-wide and actually exits (not left hanging in watch mode).

## Related

Blocks: none directly in v2.1.0, but the "semantic search" claim this fixes is referenced by `smart-context.ts`'s output text and by `docs/architecture/SMART-CONTEXT.md`, so it should land before any spec that builds new MCP tools on `smart-context.ts`.
