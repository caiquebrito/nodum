# 057 — MCP registerTool migration

## Status: done

Implemented and tested (8 rewritten `index.test.ts` cases against the new `registerTool`-based
registration). Full workspace suite green (558 core, 91 mcp, 101 cli, 15 server). Real check:
spawned the actual built server and dispatched real valid, invalid-args, and unknown-tool calls
end-to-end, confirming both the client-visible `tools/list` output and the disclosed
metrics-logging gap behave exactly as designed. Real verification also caught and fixed a genuine
TypeScript compiler limitation unrelated to this codebase's own logic. Second and final spec in the
v2.13.0 batch.

## Goal

Migrate `packages/mcp/src/index.ts` off the deprecated low-level `Server`/`setRequestHandler` API
(kept deliberately by spec 054's SDK version bump) onto the current `McpServer`/`registerTool` API.

## Why now

Twice deferred as "reshapes shared infra non-mechanically." Batch-scoping research for this release
found that framing stale post-SDK-bump: all 13 existing `handlers.ts` functions already return
exactly the `CallToolResult` shape `registerTool`'s callback expects — zero handler changes needed.
The real, bounded risks research identified going in were: all 14 hand-written JSON-Schema
`inputSchema`s need rewriting as zod raw shapes (the SDK only accepts zod), the SDK's own
`tools/list` JSON-Schema output might not byte-match the old hand-written shape, and invalid-args/
unknown-tool calls are now handled by the SDK before any registered callback runs, creating a
metrics-logging gap that needed an explicit decision, not silent discovery later.

## Scope

- Replaced `Server`/`setRequestHandler`/the manual `tools: Tool[]` array with `McpServer` and one
  `registerTool()` call per tool (14 total).
- Converted every hand-written JSON-Schema `inputSchema` to a zod raw shape — mechanical, every
  field is `z.string()`/`z.number()`/one `z.enum(...)` (the existing `type_filter` enum), with
  `.describe(...)` carrying over each original description and `.optional()` for every
  previously-non-required field.
- New shared `withMetrics<Args>(toolName, handler)` wrapper replacing the old inline dispatch
  switch's timing/`appendMetricsLog`/`countTokens`/`isError`-based-success block — written once,
  applied at all 14 `registerTool` call sites. `handlers.ts`'s 13 exported functions needed **zero
  changes**.
- **Explicit, documented decision on the metrics-logging gap**: confirmed via real end-to-end
  dispatch (not just reasoning about the SDK's types) that invalid-args and unknown-tool calls are
  now synthesized by the SDK itself, before `withMetrics`'s wrapped callback ever runs — so those two
  paths no longer produce a metrics log entry. Accepted as-is: both remain protocol-valid `isError`
  responses (confirmed by real dispatch), and are low-frequency error paths, not a correctness
  concern.
- Rewrote `packages/mcp/src/index.test.ts` entirely: mocks `McpServer`'s `registerTool` method
  directly (capturing each tool's config/callback by name) instead of spec 054's `Server`/
  `setRequestHandler` mock, preserving the same real coverage (tool registration, per-tool dispatch,
  the metrics wrapper's success/failure behavior, project-scoped log paths, transport connection).

## Out of scope

- Runtime behavior changes to any of the 14 tools' actual logic — `handlers.ts` untouched.
- A fix for the metrics-logging gap (e.g. attempting to intercept the SDK's own pre-callback
  validation/routing) — no SDK-level hook exists for this per research; accepted as a documented,
  bounded gap rather than working around SDK internals.

## Design

### A real TypeScript compiler limitation found and fixed during implementation, unrelated to this codebase's own logic

Converting the first `inputSchema` to a zod raw shape produced a real `TS2589: Type instantiation is
excessively deep and possibly infinite` compiler error — reproduced even with the SDK's own simplest
possible usage (one `registerTool` call, one `z.string()` field, no custom wrapper at all) in a
scratch file under this exact package's `tsconfig.json`. Bisected systematically: the error
disappeared entirely when `moduleResolution` was set to `"bundler"` instead of the root config's
`"node"` (classic) resolution, with every other setting held identical. This is a genuine
incompatibility between `@modelcontextprotocol/sdk`'s deeply conditional zod-compatibility types
(supporting both zod v3 and v4 simultaneously) and TypeScript's classic module resolution — not
something fixable by restructuring this codebase's own call sites, and not previously encountered
because no prior spec used a type this structurally complex from this SDK.

Fixed with a scoped `moduleResolution: "bundler"` override in `packages/mcp/tsconfig.json` only —
the sole package depending on this SDK — rather than changing the root `tsconfig.json` used by every
package. With that fix in place, `withMetrics` keeps full generic type safety
(`withMetrics<Args extends Record<string, unknown>>`) at every call site; an intermediate `any`-typed
workaround attempted during diagnosis was reverted once the real root cause was found and fixed.

### The metrics-logging gap, verified for real rather than assumed from the SDK's types

Rather than trust the type-level analysis alone, dispatched real invalid-args and unknown-tool calls
against the actual built server and inspected the real metrics log file: confirmed a successful
`project_status` call produced a log entry, while the invalid-args `get_node` call and the
unknown-tool call produced none — exactly the gap research predicted, now confirmed against real
behavior rather than just the SDK's type signatures.

## Acceptance criteria

- [x] All 14 tools registered via `McpServer.registerTool`, each with a zod `inputSchema` carrying
      over the original description/required/optional shape.
- [x] `handlers.ts` unmodified.
- [x] `withMetrics` applies the same timing/success/project-scoping logic as the old inline dispatch
      block, verified via rewritten tests covering the same ground as spec 054's version.
- [x] A real spawned server's `tools/list` output for every tool preserves the original names,
      descriptions, and required/optional fields — verified directly, not assumed; the only
      differences found (`additionalProperties: false`, a `$schema` key, a new `execution` metadata
      field) are additive/stricter, not breaking.
- [x] A real spawned server correctly returns protocol-valid `isError` responses for a valid call,
      an invalid-args call, and an unknown-tool call — verified via real end-to-end dispatch.
- [x] The invalid-args/unknown-tool metrics-logging gap is confirmed real (via actual log file
      inspection) and was an explicit, documented decision, not a silent behavior change.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

Rewritten `index.test.ts` (8 cases): all 14 tools registered with a zod `inputSchema` and
description; `get_node` dispatch passes the right arguments to `handleGetNode`;
`get_dependencies`/`get_dependents` dispatch to `handleGetDeps` with the correct direction; a thrown
handler error is caught and returned as `isError`; metrics logging records `success: true`/`false`
correctly; the metrics log path is scoped by `project_name` when present and falls back to
`_unscoped` otherwise; `server.connect()` is called once on module load. (The prior "unknown tool"
unit test was removed — that logic no longer lives in this codebase at all, since the SDK now owns
routing; its behavior is covered by this spec's real end-to-end verification instead, the more
appropriate layer for SDK-owned behavior.) Full existing `handlers.test.ts` suite (20 cases)
verified unmodified and green.

**Real end-to-end (mandatory):** built the real package, spawned the actual compiled server, and:
inspected the real `tools/list` response for every tool's schema shape versus the pre-migration
hand-written schemas; dispatched a real valid `tools/call` (`project_status`), a real invalid-args
call (`get_node` missing its required `node_id`), a real unknown-tool call, and a real
well-formed-but-logically-invalid call (`get_node` with a nonexistent `node_id`) — confirmed all
four responses were correctly shaped and protocol-valid; inspected the real on-disk metrics log
file before and after to confirm the disclosed logging gap matches actual behavior exactly.

## Success Metrics

- Real check: a genuine TypeScript compiler limitation (not a logic bug in this codebase) was found,
  bisected to its exact root cause (`moduleResolution: "node"` vs `"bundler"`), and fixed with a
  minimal, scoped override — verified by restoring full generic type safety afterward, not settling
  for a weaker `any`-typed workaround.
- Real check: the metrics-logging gap this migration was known to introduce was verified against
  real on-disk log output, not just reasoned about from the SDK's type signatures — confirming the
  documented decision matches actual runtime behavior.
- Zero behavior change to any of the 14 tools' actual logic — `handlers.ts` untouched throughout.

## Related

Second and final spec in the v2.13.0 batch (tree-sitter parser leak fix, MCP registerTool
migration). Independent of spec 056. Builds on spec 054's SDK version bump and spec 050's `isError`
protocol fix.
