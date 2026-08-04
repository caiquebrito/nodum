import { describe, it, expect } from 'vitest';
import { buildSmartContext } from '@caiquebrito/nodum-mcp/dist/smart-context.js';

// Regression ceilings for a deterministic, offline check — these gate every
// PR (unlike the API-calling accuracy suite, moved to a nightly/manual
// workflow — see spec 028). If a legitimate change to smart-context.ts
// pushes real fixture output past these, raise the ceiling deliberately and
// say why in the PR; don't raise it silently to make a regression pass.
const NORMAL_QUERY_CEILING = 500;
const HUB_QUERY_CEILING = 400; // post-spec-027: this was in the thousands pre-fix

// Spec 070 (adjacency reuse, default token_budget, footer compression,
// decoration-trim evaluation) deliberately did NOT lower these: both fixture
// calls below go through `buildSmartContext` directly with no `cache` and no
// `tokenBudget`, and spec 070's response-shaping changes only fire on that
// axis — the default `token_budget` is applied at the `search_graph` MCP
// tool boundary (`packages/mcp/src/index.ts`), not inside `buildSmartContext`
// itself, and footer compression requires a `ConversationCache` to track
// session state. Measured directly: both fixtures produce byte-identical
// `approxTokens` (89 for the normal-query fixture, 280 for the hub-query
// fixture) before and after spec 070's changes, so there's nothing real to
// tighten against on this specific code path. Decoration trim was measured
// and, per that spec's Success Metrics, left in place (savings were real but
// modest — 4-12% depending on shape — and there was no way to measure
// downstream-LLM comprehension impact in this environment), so it doesn't
// move these numbers either.

const normalGraph = {
  project: 'proj',
  stats: { files: 3, functions: 2, classes: 0, interfaces: 0, edges: 2 },
  nodes: [
    { id: 'auth.ts', label: 'auth.ts', type: 'file', file: 'auth.ts', group: 'service' },
    { id: 'auth.ts__login', label: 'login', type: 'function', file: 'auth.ts', group: 'service' },
    { id: 'auth.ts__logout', label: 'logout', type: 'function', file: 'auth.ts', group: 'service' },
  ],
  edges: [
    { source: 'auth.ts', target: 'auth.ts__login', relation: 'defines' },
    { source: 'auth.ts', target: 'auth.ts__logout', relation: 'defines' },
  ],
};

const hubGraph = {
  project: 'hubproj',
  stats: { files: 301, functions: 1, classes: 0, interfaces: 0, edges: 300 },
  nodes: [
    { id: 'hub.ts', label: 'hub.ts', type: 'file', file: 'hub.ts', group: 'util' },
    { id: 'hub.ts__init', label: 'init', type: 'function', file: 'hub.ts', group: 'util' },
    ...Array.from({ length: 300 }, (_, i) => ({
      id: `importer${i}.ts`,
      label: `importer${i}.ts`,
      type: 'file',
      file: `importer${i}.ts`,
      group: 'other',
    })),
  ],
  edges: Array.from({ length: 300 }, (_, i) => ({
    source: `importer${i}.ts`,
    target: 'hub.ts',
    relation: 'imports',
  })),
};

describe('context size regression', () => {
  it('stays under the ceiling for a normal, non-hub query', async () => {
    // Spec 041 replaced the old positional `(query, graph, maxNodes, cache)`
    // signature with a `SmartContextOptions` object — this call used to pass
    // `25` positionally where `options` now lives, which destructured to
    // all-undefined and silently fell back to the same default (`maxNodes:
    // 25`), so the test kept passing without exercising what it appeared to
    // (spec 063). Passing `{ maxNodes: 25 }` explicitly now.
    const { approxTokens } = await buildSmartContext('login', normalGraph as any, { maxNodes: 25 });
    expect(approxTokens).toBeGreaterThan(0);
    expect(approxTokens).toBeLessThan(NORMAL_QUERY_CEILING);
  });

  it('stays bounded for a query matching a heavily-imported hub node (spec 027 regression guard)', async () => {
    const { approxTokens } = await buildSmartContext('hub', hubGraph as any, { maxNodes: 25 });
    expect(approxTokens).toBeGreaterThan(0);
    expect(approxTokens).toBeLessThan(HUB_QUERY_CEILING);
  });
});
