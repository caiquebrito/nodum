# 050 — MCP isError protocol fix

## Status: in progress

## Goal

Fix a real protocol bug: every error path in `packages/mcp` returns a bare `{ error: string }`
object, which is not a valid `CallToolResult` per the MCP SDK's own `CallToolResultSchema` — a
schema-invalid response that likely surfaces to a real MCP client as a transport/parse failure
rather than the actual error message.

## Why now

Confirmed via `node_modules/@modelcontextprotocol/sdk`'s own `types.js`/`types.d.ts`:
`CallToolResultSchema` requires `content` (a `TextContent`/`ImageContent`/`EmbeddedResource[]`, not
optional) and defines `isError` as a separate optional boolean. `packages/mcp/src/handlers.ts` has
17 sites returning `{ error: string }` instead — every one of them schema-invalid. This is
independent of the pinned SDK version (`^0.7.0`, resolved `0.7.0`) already defining this exact
schema shape; the MCP SDK major-version upgrade (0.7.0 → 1.30.0) is separately deferred to its own
future investigation, not needed for this fix. First spec in the v2.11.0 batch — smallest,
most mechanical, highest value-per-line of the three confirmed specs.

## Scope

- New `errorResult(message: string): { content: TextContent[]; isError: true }` helper in
  `handlers.ts`, reusing the existing `text()` helper.
- All 17 `return { error: ... }` sites across `handlers.ts` (`handleSync`, `handleStatus`,
  `handleGetGraph`, `handleGetNode`, `handleSearch`, `handleGetDeps` ×2, `handleAnalyzeFile` ×2,
  `handleExpandCluster` ×2, `handleTraceImpact` ×2, `handleFindBottlenecks`,
  `handleExplainArchitecture`, `handleFindSimilarCode`, `handleSuggestRefactoring`) now call
  `errorResult(...)` instead.
- `index.ts`'s `CallToolRequestSchema` dispatch: `result`'s type narrows to
  `{ content: TextContent[]; isError?: boolean }` (dropping the old `{ error: string }` union
  member); the `default` (unknown tool) and top-level `catch` branches build the same
  content/isError shape directly. The metrics-logging `success` flag now reads `!result.isError`
  instead of `!("error" in result)`; `responseText` is always defined now that `content` is always
  present (no more `"content" in result` narrowing needed).

## Out of scope

- The MCP SDK major-version upgrade (0.7.0 → 1.30.0) — a real breaking-change risk (Server/
  setRequestHandler → McpServer/registerTool, transport rework, zod v4) that needs its own
  investigation spike, deliberately not bundled with this mechanical fix.
- `packages/server` authentication — considered during this batch's scoping and declined; spec
  047's loopback-default fix was found sufficient for now.
- Runtime `inputSchema` validation via zod for tool call arguments — deferred until after the SDK
  upgrade, since SDK 1.x's `registerTool` would natively consume zod schemas.

## Design

Confirmed the SDK's real schema shape directly before writing any fix code, per this project's
established practice:

```
export const CallToolResultSchema = ResultSchema.extend({
    content: z.array(z.union([TextContentSchema, ImageContentSchema, EmbeddedResourceSchema])),
    isError: z.boolean().default(false).optional(),
});
```

(`node_modules/@modelcontextprotocol/sdk/dist/types.js:667-670`) — `content` required, `isError`
optional and defaulting `false`. This confirms the fix target precisely: every handler must always
return `content`, and set `isError: true` only on the failure path.

A single `errorResult` helper (rather than repeating the three-line object literal at all 17 sites)
keeps every error path consistent and makes the shape a one-place fact, not a convention 17 call
sites have to individually get right.

## Acceptance criteria

- [x] Every one of the 17 `handlers.ts` error-return sites returns a `CallToolResultSchema`-valid
      object (`content` + `isError: true`), not a bare `{ error }`.
- [x] `index.ts`'s dispatch never returns a bare `{ error }` object either (unknown-tool and
      top-level-catch branches included).
- [x] Metrics logging (`success` flag) still correctly distinguishes error vs. non-error results
      after the shape change.
- [x] A real error response, dispatched through the actual MCP server process (not just the
      handler function in isolation), round-trips through the SDK's own `CallToolResultSchema`
      without validation failure.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`handlers.test.ts`: updated the existing error-shape assertions (`"error" in result`, `{ error:
... }`) to the new `{ content: [...], isError: true }` shape — mechanical updates to already-existing
error-path coverage, not new test-writing. Added one new test that parses a real handler's error
result through the SDK's own imported `CallToolResultSchema` (`CallToolResultSchema.parse(result)`)
— this is the test that actually proves the bug is fixed, since nothing in the prior suite validated
against the SDK's real schema.

**Real end-to-end (mandatory):** spawned the actual built MCP server (`packages/mcp/dist/index.js`)
as a child process, sent a real `initialize` then a real `tools/call` request for `get_node` with a
nonexistent project, and inspected the raw JSON-RPC stdout. Confirmed the response is now
`{"result":{"content":[{"type":"text","text":"Failed to get node: ..."}],"isError":true}, ...}` —
protocol-valid — where it was previously the schema-invalid `{"result":{"error":"..."}}`.

## Success Metrics

- Real check: a real spawned MCP server process, given a real invalid tool call, now emits a
  `CallToolResultSchema`-valid JSON-RPC response instead of the previous schema-invalid one —
  verified via actual stdout inspection, not a synthetic unit test alone.
- Zero behavior change for any successful (non-error) tool call — every success-path `return`
  statement in `handlers.ts` was left untouched.

## Related

First spec in the v2.11.0 batch (MCP protocol fix, Kotlin module labeling, all-pairs near-duplicate
grouping). Independent of the other two — no shared code.
