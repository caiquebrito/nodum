# 078 — `packages/server`: token auth for non-loopback binds

## Status: refined — not started

## Goal

Add a real, opt-in authentication check to `packages/server` (`nodum serve`) so binding beyond
loopback (`NODUM_HOST=0.0.0.0` or a LAN IP — spec 047's opt-in wider-bind path) doesn't expose
every synced project's full graph — file paths, symbol names, dependency structure, via
`GET /api/projects` and `GET /api/projects/:projectName/graph` in `packages/server/src/app.ts` —
to anyone who can reach that interface, with no credential required.

## Why now

This has been **considered and declined twice already** (v2.11.0, v2.12.0 per
`docs/development/ROADMAP.md`'s "Next" section) as not urgent enough to force into a batch, on the
grounds that the risk requires a deliberate `NODUM_HOST` opt-in and the package is
read-only/metadata-only. Picking it up now isn't because that judgment was wrong — it's because
the roadmap's own "Next" list has been worked down to exactly this item, the cross-language-dup
prerequisite gap, and Dart/Flutter's own prerequisite gap; this is the only one of the three with
no unbuilt dependency and a small, well-bounded implementation surface (two GET routes, one
existing `createApp` factory function). Re-confirm the "not urgent" framing still holds before
implementing — if it does, this spec's job is to say so explicitly a third time with today's
reasoning, not to force code that doesn't serve a real need.

## Scope

**Research/decision step first** (same posture 074/077 use): confirm this is still worth building
before writing the auth code. Check:
- Whether `nodum serve`'s real-world usage (if any signal exists in `~/.nodum/*/logs/metrics.jsonl`
  across synced projects, or in how this codebase itself has been run) shows non-loopback binds
  actually happening, vs. staying purely loopback-only in practice.
- Whether a minimal token scheme is actually simple to add cleanly to `createApp`'s existing
  Express setup, or whether it would need disproportionate new surface (session storage, a login
  flow) for what's still a single-user local tool.

**If still worth building**, the smallest real scheme fitting this server's actual shape:
- A single static bearer token, generated once (e.g. on first non-loopback `nodum serve` start,
  written to `~/.nodum/server-token` if it doesn't already exist — not committed, not
  environment-only, so it survives across restarts without the user having to manage an env var
  themselves) and required via an `Authorization: Bearer <token>` header (or a `?token=` query
  param, since the viewer is a plain browser SPA hitting these routes directly — check which is
  more realistic for `packages/viewer`'s actual fetch calls before choosing) on every
  `/api/*` route, enforced only when the server is NOT bound to loopback (matching the existing
  `NODUM_HOST !== '127.0.0.1' && NODUM_HOST !== 'localhost'` check already in
  `packages/cli/src/commands/serve.ts`) — loopback stays credential-free, matching today's
  behavior exactly, since the actual threat model is "who else can reach this interface," not
  local same-machine access.
- Print the token to stdout on server start when auth is active (`packages/cli/src/commands/
  serve.ts`'s existing console.log block), and the URL the user needs (`?token=...`) to open the
  viewer with it already attached — no separate "login" UX needed for a single-operator tool.

## Out of scope

- Multi-user accounts, sessions, or any credential storage beyond the single static token —
  disproportionate to what `packages/server` actually is (a read-only local dev tool), the same
  "don't build a separate product" reasoning spec 074 used to decline a companion macOS app for
  Xcode.
- HTTPS/TLS — orthogonal to authentication and not this spec's problem; a non-loopback bind today
  is already assumed to be on a trusted network (Docker/devcontainer/WSL, per the existing
  `NODUM_HOST` doc comment), and adding TLS is a separate, larger scope than "who can call these
  two GET routes."
- Any change to the loopback-only default path — spec 047 already made that the safe default;
  this spec only adds a gate to the already-opt-in wider-bind path.

## Design

Deliberately left open pending the research step above — the real question ("is this worth
building at all, a third time") isn't answered yet, and prescribing exact middleware shape before
that answer risks the same premature-implementation trap spec 077 explicitly avoids. If the
research step confirms it's worth building: an Express middleware in `createApp`
(`packages/server/src/app.ts`) checking the bound host at app-creation time (already known —
`createApp(dataDir)` would need one more parameter, the effective host, threaded from
`packages/cli/src/commands/serve.ts`'s existing `host` variable) and comparing a constant-time
string check (`crypto.timingSafeEqual`, not `===`, to avoid a timing side-channel on the token
comparison itself — this codebase already reaches for real crypto primitives elsewhere, e.g.
`duplicate-hash.ts`'s `createHash`) against the stored token.

## Acceptance criteria

- [ ] A documented decision either way, added to `docs/development/ROADMAP.md`'s "Next" section
      alongside the two prior "considered and declined" entries — a third real answer, not a
      third open question.
- [ ] If built: a non-loopback `nodum serve` refuses `/api/*` requests without a valid token
      (real integration test against `packages/server/src/app.test.ts`'s existing `createApp`
      harness, not just a unit test of the comparison function), and loopback binds are
      unaffected (existing `app.test.ts` cases stay green with zero changes needed).

## Test plan

- `packages/server/src/app.test.ts`: extend with a case constructing `createApp` in
  "non-loopback" mode and asserting a 401/403 on `/api/projects` without a token, 200 with the
  correct one, and a wrong-token case.
- Real check: start `nodum serve` with `NODUM_HOST=0.0.0.0` for real, `curl` `/api/projects`
  without a token (expect rejection) and with the printed token (expect success) — the same
  "spawn the real process, not a mock" discipline specs 072/073 used for the LSP binary.

## Success Metrics

Not a ranking/retrieval or token-cost change — no `retrieval-eval.ts`/`benchmarks/harness.ts`
before/after applies. Success is the acceptance criteria above.

## Related

- `docs/development/completed/047-server-hardening/spec.md` — the loopback-only default and the
  `NODUM_HOST` opt-in this spec extends.
- `docs/development/ROADMAP.md`'s "`packages/server` real authentication" entry under "Next" — the
  source of this spec's scope and its two prior "considered and declined" decisions.
