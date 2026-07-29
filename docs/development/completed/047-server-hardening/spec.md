# 047 — packages/server security hardening

## Status: done

Implemented and tested (15 new cases — first real test suite `packages/server` has ever had; full
workspace suite green — 459 core, 96 cli, 15 server, 77 mcp, 8 benchmarks, 655 total, up from 640
before this spec). Real check: the path-traversal vulnerability was empirically confirmed against
the *unpatched* server first — a sentinel file planted outside the data directory, read
successfully via a URL-encoded `..%2F` payload through the real running HTTP API — before any fix
was written, establishing this as a real, exploitable bug rather than a theoretical one. The fix
was then verified against the same live setup (payload blocked, legit requests unaffected), and
the bind-host fix was verified by curling the machine's real LAN IP before (reachable) and after
(refused) the change, with `NODUM_HOST=0.0.0.0` restoring reachability plus a printed warning.
Second of four specs in the v2.10.0 batch.

## Goal

Fix two real security issues in `packages/server` found during v2.10.0's scoping research: an
unvalidated `projectName` route parameter enabling path traversal, and an unauthenticated
`0.0.0.0` bind exposing every synced project's graph on any shared network.

## Why now

Neither issue was hypothetical. Confirmed via a live reproduction before writing any code (see
Design) that a crafted request could read arbitrary `graph/graph.json` files outside the intended
data directory, and that the server bound to all network interfaces by default with zero
authentication — meaning anyone on the same coffee-shop/office network as a running `nodum serve`
could read file paths, symbol names, and dependency structure for every project ever synced on that
machine.

## Scope

- New `packages/server/src/project-path.ts`: `resolveProjectGraphPath(dataDir, projectName):
  string | null` — rejects empty/`.`/`..`/any name containing `/`, `\`, or a NUL byte, then
  resolves `dataDir/projectName/graph/graph.json` and requires the resolved path to stay under
  `resolve(dataDir) + sep` (a containment check). **Deliberately not a character allowlist** — a
  project name comes from a real directory `basename()` (`sync.ts` et al.) and can legitimately
  contain spaces, `+`, or non-ASCII characters; an allowlist regex would be a real behavior
  regression for those users, while containment rejects nothing legal.
- `app.ts`'s `/api/projects/:projectName/graph` route uses the resolver — `400 {error: "Invalid
  project name"}` when it returns null, the pre-existing `404` on a genuine read failure. Also
  drops the unused `express.json()` body parser (no POST/PUT route exists anywhere in this app) —
  free attack-surface reduction found during this spec's own review.
- `packages/cli/src/commands/serve.ts` now binds `127.0.0.1` by default instead of the previous
  bare `app.listen(port)` (which binds `0.0.0.0` — every interface). A new `NODUM_HOST` env var
  opts into a wider bind; binding to anything other than `127.0.0.1`/`localhost` prints an explicit
  warning naming the exposure, since authentication is out of scope for this spec (see below).
- Fixed an adjacent, real bug found during this spec's review: `packages/viewer/app.js`'s graph
  fetch interpolated the project name into the URL without `encodeURIComponent` (unlike the
  sibling project-list fetch and the CLI's own browser-open call, both of which already encode) —
  a live bug for any project name containing `+`, a space, or non-ASCII characters.
- Updated `nodum serve`'s CLI help text and `docs/guides/RUN.md` to document `NODUM_PORT`/
  `NODUM_HOST` and the no-authentication caveat, including a note that Docker/devcontainer/WSL
  users may need `NODUM_HOST=0.0.0.0` to reach the viewer from outside a container.

## Out of scope

- **Real authentication** (token/session scheme) — the loopback-by-default bind plus an explicit,
  warned opt-in is the right-sized fix for this spec; adding real auth is substantial enough to be
  its own future spec, not folded in here.
- **A `realpath()`/symlink-escape check** in `resolveProjectGraphPath` — `~/.nodum` is created and
  exclusively written by nodum itself (no user-supplied symlinks are ever placed there), so the
  lexical containment check's blind spot (a symlink inside the data dir pointing outside it) is
  documented as an accepted limitation rather than adding an async `fs` call to every request.
- Any change to how project names are generated (still `basename(resolve(projectPath))`,
  unchanged) — this spec only hardens how an already-generated name is consumed by the server.

## Design

### Confirming the vulnerability before writing the fix

Per this project's established practice, the exploit was reproduced live against the real,
unpatched server before any fix code was written — this determined the spec's framing (a
confirmed real bug, not "defense in depth against a latent one"). Built a temp data directory with
a legitimate project and a sentinel file (`{"SENTINEL": "..."}`) planted as a *sibling* of the data
directory; started the real `createApp()` server against it; curled a legit request (200, correct
content) and a raw un-encoded `../` request (caught by Express's own route normalization, falls
through to the SPA catch-all — **not** exploitable this way); then a URL-encoded `..%2F` request —
which reached the route handler with `req.params.projectName === "../sentinel-outside-data-dir"`
and returned the sentinel's content directly. Express URL-decodes route params *after* routing, so
the encoded form survives path-segment matching while the raw form doesn't — a subtlety worth
recording for anyone who later "verifies" this class of bug with only a raw-`../` test and
concludes there's nothing to fix.

### Containment check, not an allowlist

A character-allowlist regex (`/^[A-Za-z0-9._-]+$/`) was considered and rejected — real project
names on this machine's own `~/.nodum` already include names with spaces, and a strict allowlist
would 400 legitimate users with unicode or `+` in their directory names. `resolve()`-based
containment is strictly stronger (blocks every traversal an allowlist would, plus anything an
allowlist's author didn't think to exclude) while accepting every name that's actually legal on
the filesystem.

## Acceptance criteria

- [x] A URL-encoded `..%2F` (and double-encoded) traversal payload against
      `/api/projects/:projectName/graph` returns `400` and never the content of a file outside the
      data directory — verified against a real running server, both before (vulnerable) and after
      (fixed) this spec's change.
- [x] A legitimate project name, including one containing a `.`, still resolves and returns `200`
      with its real graph — proving the fix doesn't over-reject legal names.
- [x] `nodum serve` binds to `127.0.0.1` by default — verified unreachable via the machine's real
      LAN IP; `NODUM_HOST=0.0.0.0` restores reachability with an explicit warning printed.
- [x] The viewer's static assets (`index.html`, `app.js`, `style.css`) and the full sync → serve →
      fetch-a-real-graph path all still work end-to-end after both the `express.json()` removal
      and the viewer's `encodeURIComponent` fix.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

First real test suite for `packages/server`: `project-path.test.ts` (8 unit cases — plain name,
dotted name, space/unicode names, empty, `.`/`..`, embedded `/`, `\`, NUL byte) and `app.test.ts`
(7 cases — a real `app.listen(0)` against a temp data dir with a legit project, a dotted-name
project, and a sentinel planted outside the data dir; asserts a legit request succeeds, an unknown
project 404s, and encoded/double-encoded/bare-`..` traversal payloads all return `400` and never
leak the sentinel content).

**Real end-to-end (mandatory, and this spec's central evidence):** the live pre-fix reproduction
described in Design; the same reproduction re-run against the patched build (blocked); a real
`nodum serve` process curled via `127.0.0.1` (works) and the machine's real LAN IP (before: works,
after: refused) to prove the bind-host fix; `NODUM_HOST=0.0.0.0` re-tested to confirm the escape
hatch still works with the warning printed; a full static-asset + API smoke check (`index.html`,
`app.js`, `style.css`, `/api/projects`, `/api/projects/:name/graph` all returning `200` against a
real synced fixture) proving neither the `express.json()` removal nor the viewer's encoding fix
broke the live serving path.

## Success Metrics

- Real check: the exact sentinel-read exploit worked against the unpatched server (confirmed,
  documented above) and was blocked after the fix, using the identical request against the same
  running process — the strongest form of before/after evidence available for a security fix.
- Real check: `lsof` confirmed the bound interface changed from `*:<port>` (all interfaces) to
  `127.0.0.1:<port>` (loopback only) after the fix, and a live curl against the machine's real LAN
  IP address failed (connection refused) post-fix where it had succeeded pre-fix.

## Related

Second of four specs in the v2.10.0 batch (housekeeping, server hardening, near-duplicate
detection, Kotlin source-set labeling). Fully independent of the other three — no shared code.
