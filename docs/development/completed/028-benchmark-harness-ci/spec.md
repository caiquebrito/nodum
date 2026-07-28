# 028 — Trustworthy benchmark harness

## Status: done

Implemented and tested (8 new tests across `benchmarks/metrics.test.ts` and
`benchmarks/context-size.test.ts`; full workspace suite — 196 core, 95 cli, 24 mcp, 8
benchmarks, 323 total — green via both `npm install` and a clean `npm ci`). Real check: ran the
existing API-key-free `v2-demo` script after deleting the stale compiled `.js` files to confirm
`ts-node`/`tsx` still resolve every sibling import against real `.ts` sources. Also uncovered and
fixed a genuine bug along the way — see "Bugs found during real implementation."

## Goal

Make `benchmarks/` actually run — currently it's a standalone package with its own
`node_modules`, no test runner, and no CI wiring, so nothing in `packages/` guarantees a token
efficiency regression gets caught before it ships. Split it into two honest halves: a
deterministic, offline suite that's fast enough to gate every PR, and the existing
API-calling accuracy suite, which cannot and should not run on every PR.

## Why now

Last non-test-coverage spec in the batch (029 is coverage, not new checks). It depends on 024's
`countTokens` to build the offline suite and 026/027's real percentages to have something worth
regression-testing.

## Scope

- **Convert `benchmarks/` into a real workspace member**: add it to root `package.json`'s
  `workspaces` array; remove its standalone `node_modules`/`package-lock.json` so npm hoists its
  dependencies like every other package; mark it `"private": true` (never published, same
  posture as the root package).
- **Split the suite, don't merge it.** `harness.ts` and `v2-comparison.ts` call the real
  Anthropic API — gating every PR on them would mean a required secret, real spend, and network
  flake on PRs that never touch `benchmarks/`. Two new, genuinely offline test files instead:
  - `benchmarks/metrics.test.ts` — unit tests for `scoreAccuracy()` and `aggregateResults()`.
  - `benchmarks/context-size.test.ts` — calls `buildSmartContext()` (from `nodum-mcp`) against
    fixed, hand-authored graphs (including a hub-heavy one, the same shape 027 fixed) and asserts
    `approxTokens` stays under a checked-in ceiling. This is the actual CI-gated regression
    check the v2.2.0 plan asked for — `npm test --workspaces` picks it up automatically since
    vitest's default include (`*.test.ts`) covers it, with zero changes needed to `ci.yml`.
  - `harness.ts` / `v2-comparison.ts` are untouched and stay outside vitest's default include
    pattern (they're not `*.test.ts` files) — they simply don't run under `npm test`.
- **A new workflow for the API-calling half**: `.github/workflows/benchmark-accuracy.yml`,
  triggered by `workflow_dispatch` (manual) and a nightly `schedule`, running the existing
  `harness.ts` against `ANTHROPIC_API_KEY` (a new repository secret, not yet added — this spec
  wires the workflow, adding the actual secret is a manual step same as `NPM_TOKEN`/`RELEASE_PAT`
  were in spec 000).
- `benchmarks/metrics.ts`'s `scoreAccuracy()`: add a length-based precision proxy (see Design) so
  a response padded well past what's needed to contain the expected keywords scores lower than a
  concise correct one, even though both currently score identical recall.
- Fix the invalid Anthropic model ID `claude-opus-4-7` (doesn't exist) in `benchmarks/claude-api.ts`
  and `docs/guides/SETUP-GUIDE.md` — replaced with `claude-opus-5`, and made overridable via
  `NODUM_BENCHMARK_MODEL` so the same staleness can't quietly recur.
- One additional fixture project — `benchmarks/projects/python-hub-app/` — a small Python project
  (the roadmap's own exploration found Python parsing is the weakest of the five languages, so
  it's the most useful second fixture) with one module imported by several others, giving the
  accuracy suite a non-TypeScript, hub-shaped fixture alongside `sample-next-app`.
- Fix a real, unrelated ESLint config bug found while checking `npm run lint`'s state: the rule
  name `@typescript-eslint/explicit-function-return-types` doesn't exist (should be singular,
  `-type`) — it was hard-erroring on 4 `packages/server` files with a config error, not a real
  lint finding.
- **Delete the stale compiled `.js` files sitting alongside every `.ts` source in
  `benchmarks/`** (`claude-api.js`, `metrics.js`, `report-generator.js`, `v2-comparison.js`,
  `datasets/schema.js`). **Correction to the v2.2.0 plan's framing**: it listed these as
  "committed build artifacts" (housekeeping); `git ls-files` shows they were never actually
  tracked — `*.js` is globally gitignored in this repo. They were untracked local disk cruft
  (present in this environment's checkout, likely from an old local build, invisible to `git
  status`), not something anyone else's clone or CI would have had. That makes the bug below
  narrower in blast radius than "affects every contributor" — but it's still real for anyone
  whose local `benchmarks/` happens to accumulate the same leftover files, and it's exactly the
  kind of thing "trustworthy benchmark harness" should not be silently vulnerable to. See "Bugs
  found during real implementation."

## Out of scope

- **Adding `npm run lint` as a required CI check.** The v2.2.0 plan named this, but checking
  reality first: `npm run lint` currently reports **235 problems (48 errors, 187 warnings)**
  across the existing codebase, none related to this spec or introduced by it. Gating CI on lint
  today would break every future PR on a pre-existing backlog. Fixed the one config-level bug
  that was a genuine typo (see Scope); left the 235 real findings as their own future cleanup —
  this is the same kind of correction 023 made about the `linked`/`fixed` versioning assumption
  and 026 made about the cache-hit token claim: check the plan against reality before executing it
  literally.
- **Running the accuracy workflow for real.** Wiring `benchmark-accuracy.yml` is in scope; adding
  the `ANTHROPIC_API_KEY` secret and triggering a real run isn't — that's the repo owner's call,
  same as every other one-time secret this project has added (spec 000's `NPM_TOKEN`, the
  `RELEASE_PAT` follow-up).
- **True precision** (checking for *incorrect* claims a response makes) — the dataset has no
  ground truth for what a response should *not* say, so there's nothing to check false positives
  against. The length-based proxy added here is named and documented as a proxy, not asserted as
  real precision.
- **Rewriting the README's benchmark numbers with new measured figures** — that requires actually
  running the (now fixed) accuracy suite across real projects with a real API key, which this
  spec doesn't do. 026 already reframed those numbers as historical; this spec doesn't add new
  ones to replace them with.
- Building a `nodum metrics` command or dashboard to read `metrics.jsonl` (025's log) — that's
  reading what this release writes, a separate concern from the benchmark suite itself.

## Design

### 1. Root `package.json`

```diff
   "workspaces": [
     "packages/core",
     "packages/cli",
     "packages/server",
-    "packages/mcp"
+    "packages/mcp",
+    "benchmarks"
   ],
```

### 2. `benchmarks/package.json`

```diff
 {
   "name": "nodum-benchmarks",
   "version": "1.0.0",
+  "private": true,
   "description": "Benchmark suite for measuring nodum RAG effectiveness",
   "type": "module",
   "scripts": {
+    "test": "vitest run",
     "run": "node --loader ts-node/esm ./harness.ts",
     ...
   },
   "dependencies": {
     "@anthropic-ai/sdk": "^0.28.0",
-    "@caiquebrito/nodum-core": "file:../packages/core"
+    "@caiquebrito/nodum-core": "file:../packages/core",
+    "@caiquebrito/nodum-mcp": "file:../packages/mcp"
   },
   "devDependencies": {
     ...
+    "vitest": "^1.0.0"
   }
 }
```

`node_modules/` and `package-lock.json` under `benchmarks/` are removed — as a workspace member,
its dependencies are hoisted and resolved from the root lockfile like every other package.

### 3. `benchmarks/metrics.ts` — precision proxy

See the `IDEAL_WORDS_PER_EXPECTED_ELEMENT` constant and the recall/precision/F1 computation
replacing the old bare `(found / total) * 100`.

### 4. `benchmarks/context-size.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest';
import { buildSmartContext } from '@caiquebrito/nodum-mcp/dist/smart-context.js';
import { countTokens } from '@caiquebrito/nodum-core';

// Regression ceilings — if a change to smart-context.ts pushes real fixture
// output past these, something regressed; investigate before raising them.
const NORMAL_QUERY_CEILING = 500;
const HUB_QUERY_CEILING = 400; // post-027: was thousands pre-fix

describe('context size regression', () => {
  it('stays under the ceiling for a normal, non-hub query', async () => {
    const { approxTokens } = await buildSmartContext('login', normalFixtureGraph, 25);
    expect(approxTokens).toBeLessThan(NORMAL_QUERY_CEILING);
  });

  it('stays bounded for a query matching a heavily-imported hub node', async () => {
    const { approxTokens } = await buildSmartContext('hub', hubFixtureGraph, 25);
    expect(approxTokens).toBeLessThan(HUB_QUERY_CEILING);
  });
});
```

### 5. `.github/workflows/benchmark-accuracy.yml` (new)

```yaml
name: Benchmark Accuracy
on:
  workflow_dispatch: {}
  schedule:
    - cron: '0 6 * * *'  # nightly, 06:00 UTC
jobs:
  accuracy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: cd benchmarks && npm run run:sample
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Acceptance criteria

- [x] `benchmarks` is a real workspace member; `npm ci` at root resolves it; no standalone
      `benchmarks/node_modules` or `benchmarks/package-lock.json` remain.
- [x] `npm test --workspaces` runs `benchmarks/metrics.test.ts` and
      `benchmarks/context-size.test.ts` alongside the other three packages' suites, with zero
      Anthropic API calls made.
- [x] `scoreAccuracy()` scores a concise correct response higher than a padded one containing the
      same expected keywords.
- [x] The invalid `claude-opus-4-7` model ID no longer appears anywhere in the repo.
- [x] `.github/workflows/benchmark-accuracy.yml` exists, does not run on every PR, and is
      syntactically valid.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`benchmarks/metrics.test.ts` (new) — `scoreAccuracy()`: full recall + concise response scores
100; same recall padded to 10x the ideal word count scores meaningfully lower; `total === 0`
still returns 100 regardless of length (unchanged legacy behavior). `aggregateResults()`: a
two-result input averages correctly (already-existing logic, first real test coverage for it).

`benchmarks/context-size.test.ts` (new) — see Design; asserts real ceilings against real fixture
graphs, including the hub shape 027 fixed.

## Success Metrics

- Real check: `npm test --workspace=nodum-benchmarks` runs and passes with zero network calls
  (confirmed by running with `ANTHROPIC_API_KEY` unset — the new tests never construct a
  `ClaudeAPI` instance, so nothing should fail for a missing key).
- Real check: `npm run build && npm test --workspaces` from repo root, confirming `benchmarks`
  joining the workspace doesn't disturb the other four packages' builds or tests.
- Real check: after removing the stale `.js` files, ran `npm run v2-demo` (the existing
  API-key-free demo script) directly to confirm `tsx`/`ts-node` still resolve every `./*.js`
  import specifier correctly against the real `.ts` sources with no compiled sibling present.

## Bugs found during real implementation

- **The precision test initially failed with both scores at 100 — a stale local `.js` file was
  shadowing the fix.** Writing `metrics.test.ts` should have immediately shown the padded
  response scoring lower than the concise one; instead both scored 100, as if the precision
  change in `metrics.ts` had never happened. The cause: `metrics.js` — an untracked, stale
  compiled file sitting next to `metrics.ts` in this checkout — was the file actually being
  loaded. Every `.ts` file in `benchmarks/` imports its siblings by `.js` specifier (the standard
  ESM+TS convention, e.g. `import { X } from './metrics.js'`, intended to resolve to the sibling
  `.ts` source at run time via `ts-node`/`vitest`). But because a **literal** `metrics.js` also
  existed on disk (from some earlier local build — `git ls-files` confirms it was never
  committed; `*.js` is globally gitignored here), both `vitest`'s and `ts-node/esm`'s resolvers
  found and loaded that real, exactly-matching file *instead of* redirecting to the `.ts` source
  — silently running old code. Scoped correctly: this is a local-checkout hazard, not a
  repo-wide one — a fresh clone never has these files, so CI and other contributors were never
  exposed to it. Still worth fixing outright, since it's exactly the kind of thing that erodes
  trust in "did my change actually take effect" the moment it *does* happen to someone. Fixed by
  deleting all five stale `.js` files from this checkout; verified `tsx`/`ts-node` still resolve
  correctly afterward (see Success Metrics).

## Related

Depends on: 024 (`countTokens`), 027 (the hub-fixture shape this reuses as a regression guard).
Blocks nothing — 029 (coverage) and the release PR are independent of this spec's internals.
