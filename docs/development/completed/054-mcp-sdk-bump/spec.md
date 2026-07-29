# 054 — MCP SDK version bump (scoped)

## Status: done

Implemented and tested. New `packages/mcp/src/index.ts` test file — 9 cases, the codebase's first
coverage of this file. Full workspace suite green (538 core, 92 mcp, 101 cli, 15 server). Real
check: spawned the actual built server on the bumped SDK and dispatched real tool calls
end-to-end. Second spec in the v2.12.0 batch.

## Goal

Bump `@modelcontextprotocol/sdk` off the two-major-versions-old `^0.7.0` it had been pinned to,
scoped to a safe version-bump-only step — not the riskier `McpServer`/`registerTool` rewrite.

## Why now

ROADMAP.md had repeatedly deferred this upgrade, bundled together with a bigger API rewrite.
Batch-scoping research for this release confirmed the low-level `Server`/`setRequestHandler` API
`packages/mcp/src/index.ts` already uses is *deprecated* in the current `1.30.0` but **still
present, with the same constructor and method signatures** — not removed. That makes a real,
narrowly-scoped step available: bump the dependency, add `zod` (now a non-optional peer
dependency of the SDK), fix any real type drift, and — since research separately flagged this file
as the codebase's only completely untested one — add its first real test coverage before touching
it further. The bigger `McpServer`/`registerTool` rewrite (which would reshape `index.ts`'s shared
metrics/error-handling infra) stays deliberately deferred to its own future investigation.

## Scope

- Bumped `@modelcontextprotocol/sdk` in `packages/mcp/package.json` from `^0.7.0` to `^1.30.0`.
- Added `zod` (`^3.25.76`, matching the version already resolved transitively) as an explicit
  dependency — the SDK's `peerDependencies` now require `zod: "^3.25 || ^4.0"` (previously only
  pulled in transitively, undeclared).
- No source changes to `index.ts` were needed beyond the dependency bump — verified directly (not
  assumed) that `Server`, `StdioServerTransport`, `CallToolRequestSchema`, `ListToolsRequestSchema`,
  `Tool`, `TextContent`, and `CallToolResultSchema` all still resolve at their existing subpath
  import paths (`server/index.js`, `server/stdio.js`, `types.js`) with unchanged shapes.
- New `packages/mcp/src/index.test.ts` — the first test coverage for this file. Mocks the SDK's
  `Server` class (capturing the two handlers it registers via `setRequestHandler`) and
  `StdioServerTransport`, plus `./handlers.js`'s functions and `@caiquebrito/nodum-core`'s
  `appendMetricsLog`/`countTokens`/`checkLatestVersion`/`formatUpdateNotice`, mirroring
  `handlers.test.ts`'s existing mocking conventions.
- **Deliberately not attempted**: the `McpServer`/`registerTool` migration (would require
  refactoring the shared metrics/error-handling wrapper across all 14 tools, a materially larger
  and riskier change per this batch's research); native runtime `inputSchema` validation via zod
  (would naturally follow the `registerTool` migration, not this scoped bump).

## Out of scope

- Any rewrite of `index.ts`'s tool-dispatch shape.
- Runtime `inputSchema` validation.
- `packages/server`/viewer changes — unrelated, handled by spec 053.

## Design

Verified the real 1.30.0 API surface directly before writing any code, per this project's
established practice — not assumed from the version number alone:
- `node_modules/@modelcontextprotocol/sdk`'s installed `package.json` confirmed `peerDependencies`
  now require `zod`, previously only a transitive dependency via the SDK itself.
- Confirmed the deprecated `Server` class (not `McpServer`) has the identical constructor and
  `setRequestHandler` signature this codebase already calls.
- `npx tsc --noEmit` and a real dynamic `import()` of each subpath in a Node REPL confirmed every
  import this codebase uses resolves to the expected type at runtime, not just at the type level.
- Confirmed the `body-parser`/`express` vulnerabilities `npm audit` reports after this bump are
  **not** introduced by it — they trace to `packages/server`'s own pre-existing root-level
  `express@4.22.2` dependency (predating this spec entirely, confirmed via `git show HEAD:
  package-lock.json`), not to the SDK's own newly-vendored `express@5.2.1` (nested under
  `node_modules/@modelcontextprotocol/sdk/node_modules/`, a different resolved instance).

`index.test.ts`'s first tests were written to directly exercise the two request handlers `index.ts`
registers — tool listing, dispatch routing (including the `get_dependencies`/`get_dependents`
direction split), the unknown-tool path, the top-level catch path, and the metrics-logging
`success` flag (spec 050's `isError`-based check) — rather than only asserting the module loads,
since a real regression here would be in the dispatch logic, not the import statements.

## Acceptance criteria

- [x] `@modelcontextprotocol/sdk` bumped to `^1.30.0`; `zod` added as an explicit dependency.
- [x] `npx tsc --noEmit -p packages/mcp` clean — no type drift from the bump.
- [x] `index.ts` has real test coverage for the first time: tool listing, dispatch routing, the
      unknown-tool path, the top-level catch path, and metrics-logging success/failure.
- [x] Full existing `handlers.test.ts` suite passes unmodified (handlers are SDK-agnostic).
- [x] A real spawned MCP server process on the bumped SDK responds correctly to `initialize`,
      `tools/list`, and multiple real `tools/call` requests.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`index.test.ts` (9 new cases): tool listing returns all 14 tools in the expected order; dispatch
routes `get_node`/`get_dependencies`/`get_dependents` to the right handler with the right
arguments (including the direction split for deps); an unknown tool name returns a protocol-valid
`isError` result; a thrown handler error is caught and returned as `isError`; metrics logging
records `success: true`/`false` correctly for non-error/error results respectively; the metrics log
path is scoped by `project_name` when present and falls back to `_unscoped` otherwise; `server.
connect()` is called once on module load. Full existing `handlers.test.ts` (20 cases) and the rest
of the mcp suite verified unmodified and green.

**Real end-to-end (mandatory):** built the real `packages/mcp` package against the bumped SDK,
spawned the actual compiled server process, and dispatched a real `initialize`, a real
`tools/call` for `project_status` (against this machine's actual 15 synced projects), a real
`tools/call` for `search_graph` against this repo's own already-synced graph, and a real
`tools/call` for `get_node` with a deliberately invalid node id — confirmed all four responses were
well-formed and behaviorally correct end-to-end, not just type-checked.

## Success Metrics

- Real check: a genuinely spawned MCP server process, running the bumped SDK, correctly served
  real tool calls against real synced project data on this machine.
- Real check: the `npm audit` findings after this bump were traced to a pre-existing,
  unrelated `packages/server` dependency, not the SDK bump itself — confirmed via `git show`
  against the pre-change `package-lock.json`, not assumed.
- Zero behavior change for any of index.ts's existing dispatch logic — verified by its own new,
  first-ever test suite passing without needing to alter that logic at all.

## Related

Second spec in the v2.12.0 batch (viewer Sync fix, MCP SDK version bump, KMP expect/actual edges).
Independent of spec 053. Deliberately narrower than the full `McpServer`/`registerTool` migration,
which remains deferred to its own future investigation per this batch's scoping research.
