# 021 — Version-check notice

## Status: done

Implemented, tested (9 new `core/version-check.test.ts` tests covering fresh/cached/expired-cache/
network-failure/non-200/opt-out paths; full workspace suite — 187 core, 95 cli, 15 mcp — still
green), and smoke-tested end-to-end: `nodum sync` against a scratch project hit the real npm
registry, correctly reported no update available (repo's published `nodum-cli` is already at the
version installed here), and wrote `~/.nodum/update-check.json`.

## Goal

Tell users running an outdated `nodum-cli` or `nodum-mcp` that a newer version is published on
npm, without ever blocking, slowing, or failing a command.

## Why now

Neither package auto-updates. The only way users currently learn they're behind is re-reading
docs or manually diffing versions — there was no in-product signal at all.

## Scope

- `packages/core/src/version-check.ts`: `checkLatestVersion(packageName, currentVersion,
  cacheFilePath)` — hits `https://registry.npmjs.org/<pkg>/latest` with native `fetch`
  (`AbortSignal.timeout(1500)`), returns `null` on any failure (offline, non-200, timeout) instead
  of throwing. Result cached at `cacheFilePath` and reused for 24h so repeated commands don't hit
  the network every run. `formatUpdateNotice(result)` renders the one-line message.
- Opt-out: `NODUM_NO_UPDATE_CHECK` (any value) or `CI` (standard convention other CLIs already
  use) skips the check entirely — no network call, immediate `null`.
- `packages/cli/src/utils/update-notice.ts`: `getOwnVersion()` reads the CLI's own `package.json`
  via a path relative to the compiled file (`../../package.json` from `dist/bin/`) rather than a
  JSON import assertion, keeping ESM/CJS interop simple. `printUpdateNoticeIfAny(nodumDataDir)`
  wraps `checkLatestVersion` + `formatUpdateNotice`, printing to **stderr** (keeps `--json` stdout
  output machine-readable) and swallowing any error itself as a second safety net.
- Wired into the `nodum sync` and `nodum init` command actions in `bin/nodum.ts` — the two most
  commonly run commands — after their real work completes.
- `packages/mcp/src/index.ts` runs the same check once at server startup (after
  `server.connect`), reading its own version the same relative-path way, logging to stderr — this
  surfaces in Claude Code's MCP logs since users don't invoke the server directly.
- Fixed side effect: both `bin/nodum.ts`'s `program.version(...)` and the MCP `Server` constructor
  were hardcoded to the stale placeholder `"1.0.0"` (actual published versions: cli 2.2.1, mcp
  2.0.1) — now both read their real `package.json` version, since a version-check feature
  reporting the wrong current version would be self-defeating.
- Numeric semver-tuple compare (`major.minor.patch` split + compare) — no new dependency for a
  full semver library, since this only ever needs a `>` check between two `x.y.z` npm versions.

## Out of scope

- Auto-updating or self-installing anything — always a manual `npm install -g
  <pkg>@latest`, matching what's documented for users, never silent code execution.
- Checking on every CLI command (`config`, `export`, `cycles`, etc.) — only `sync`/`init` plus the
  MCP server startup, to keep network calls rare and the notice non-intrusive.
- A private/self-hosted registry mirror — assumes the public npm registry, same as the packages'
  actual publish target.
