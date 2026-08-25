# 081 — Publish `@caiquebrito/nodum-query` so `npm install -g @caiquebrito/nodum-mcp` works

## Status: done

Shipped as designed: `packages/query/package.json` no longer has `"private": true`, and
`@caiquebrito/nodum-query` was added to `.changeset/config.json`'s `fixed` group alongside
`core`/`cli`/`mcp`/`server`. `npx changeset status` confirmed all five packages resolve to the
same patch-bumped version with `.changeset/publish-nodum-query.md` in place. `npm run build && npm
test --workspaces` stayed green at 986 tests (612 core, 127 query, 51 lsp, 5 vscode-extension, 119
cli, 15 server, 18 mcp, 39 benchmarks), no regressions — this PR touched no source code.
`cd packages/query && npm pack --dry-run` produced a normal dist-only tarball (61 files, 67.6kB),
the same shape as `nodum-core`'s, confirming it's publish-ready. Merged via PR #158 once
`build-and-test` went green, per the repo's merge policy.

The registry-level fix (the 404 actually going away) still lands on the next `develop → main`
release — publishing only happens through that release train (`docs/development/PUBLISH.md`), not
this PR. That release hasn't run yet as of this spec's completion.

## Goal

Make a plain `npm install -g @caiquebrito/nodum-cli @caiquebrito/nodum-mcp` succeed for anyone
outside this repo, by publishing `@caiquebrito/nodum-query` to npm.

## Why now

A user hit `npm ERR! 404 Not Found - GET https://registry.npmjs.org/@caiquebrito%2fnodum-query`
while installing globally. Confirmed live against the registry: `@caiquebrito/nodum-cli`,
`@caiquebrito/nodum-mcp`, `@caiquebrito/nodum-core`, and `@caiquebrito/nodum-server` all resolve
(HTTP 200); `@caiquebrito/nodum-query` alone 404s. The currently-published
`@caiquebrito/nodum-mcp@2.17.2` depends on `@caiquebrito/nodum-query": "^2.17.0"` as a normal
(non-workspace-protocol) dependency, so npm must fetch it from the registry on any install outside
this monorepo — where workspace symlinks aren't available to resolve it locally instead. This
isn't a network/firewall issue on the installer's end; it's that `packages/query/package.json`
was deliberately marked `"private": true` in spec 071, which correctly kept it out of the
`packages/mcp` dependency chain *inside* the workspace but also (unintentionally, per that spec's
own wording — "not in `.changeset/config.json`'s `fixed` group") means it never gets published,
breaking every external install of `nodum-mcp` since that spec shipped.

## Scope

- `packages/query/package.json`: remove `"private": true` so it's eligible for publish. Leave
  everything else about its shape unchanged (no `exports` field, matching spec 071's deliberate
  choice to keep supporting `benchmarks/`'s deep imports).
- `.changeset/config.json`: add `@caiquebrito/nodum-query` to the existing `fixed` group
  alongside `core`/`cli`/`mcp`/`server`, so it stays version-locked with the packages that depend
  on it going forward (same rationale as spec 023 — one release number should mean one thing
  across every package that actually ships).
- Add a changeset (`.changeset/publish-nodum-query.md`) recording this as a `patch` for
  `@caiquebrito/nodum-query` (and, since `updateInternalDependencies` is `"patch"` and it's now
  in the fixed group, the other three ride along at the next release) so the next `develop → main`
  release actually publishes it.

## Out of scope

- Cutting the release itself (`develop → main`, per `docs/development/PUBLISH.md`) — that's a
  separate, deliberate action after this PR merges; publishing to npm only happens when that
  release train runs.
- Changing `packages/query`'s dependency shape, exports, or any other spec-071 decision — this is
  purely "make it publishable," not a redesign.
- Retroactively fixing already-published `nodum-mcp` versions — the next release supersedes them.

## Design

`packages/query/package.json` diff:

```diff
-  "private": true,
   "main": "./dist/index.js",
```

`.changeset/config.json` diff:

```diff
   "fixed": [
     [
       "@caiquebrito/nodum-core",
       "@caiquebrito/nodum-cli",
       "@caiquebrito/nodum-mcp",
+      "@caiquebrito/nodum-query",
       "@caiquebrito/nodum-server"
     ]
   ],
```

`.changeset/publish-nodum-query.md`:

```markdown
---
"@caiquebrito/nodum-query": patch
---

Publish `@caiquebrito/nodum-query` to npm. It was marked private in spec 071 (071-transport-neutral-query-layer),
which kept it working inside this workspace via npm workspace symlinks but left it unpublished —
since `@caiquebrito/nodum-mcp` depends on it as a normal registry dependency, every external
`npm install -g @caiquebrito/nodum-mcp` has 404'd trying to resolve it since that spec shipped.
```

## Acceptance criteria

- [x] `packages/query/package.json` no longer has `"private": true`.
- [x] `.changeset/config.json`'s `fixed` group includes `@caiquebrito/nodum-query`.
- [x] `npx changeset status` resolves all five packages (core, cli, mcp, query, server) to the
      same target version with the new changeset present.
- [x] `npm run build && npm test --workspaces` still green (no source files touched).

## Test plan

- `npx changeset status` — confirms the fixed group and pending changeset resolve without error
  and every package in the group moves to the same next version.
- `npm run build && npm test --workspaces` — regression check; this spec touches no source code.
- `cd packages/query && npm pack --dry-run` — confirms the tarball shape (dist-only, per `files`)
  is what would actually get published, matching `packages/core`'s.

## Success Metrics

The real fix ships when the next `develop → main` release runs and
`https://registry.npmjs.org/@caiquebrito%2Fnodum-query` starts returning 200 — not verifiable
from this PR alone, since publishing only happens on release (see Out of scope). This spec's own
verification is the config/build checks above; note the residual manual step in Related.

## Related

Follows on from spec 071 (071-transport-neutral-query-layer), which introduced the private,
unpublished package this spec publishes. After this PR merges, a `develop → main` release PR
(per `docs/development/PUBLISH.md`) still needs to run for the fix to actually reach npm.
