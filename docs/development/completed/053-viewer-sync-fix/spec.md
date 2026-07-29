# 053 — Fix the viewer's broken Sync button

## Status: done

Implemented and tested. No new test file needed (`packages/viewer` has no existing test suite,
and this is a pure removal of dead code) — verified instead via a real served `nodum serve`
instance. Full `packages/server`/`packages/cli` suites stay green (15 server, 101 cli). First spec
in the v2.12.0 batch.

## Goal

Remove a real, confirmed-dead UI action: the viewer's Sync button calls `POST /api/sync`, an
endpoint `packages/server` has never implemented.

## Why now

Batch-scoping research for `packages/server` real authentication found the residual risk after
spec 047's hardening (loopback-only default bind, path-traversal fix) too low to justify building
token auth this batch — but while investigating the server's actual HTTP surface, found
`packages/viewer/app.js`'s `syncProject()` function (wired to `index.html`'s Sync button) does
`fetch('/api/sync', { method: 'POST', ... })` against a route that `packages/server/src/app.ts`
has never defined. `app.ts` even already carries an explicit comment confirming this is deliberate,
not an oversight — `// Note: Sync is handled via CLI, not via HTTP API yet` — but nobody had gone
back and removed the client-side button that assumes otherwise. Every click silently 404s.

## Scope

- Removed the `Sync` button (`<button id="btn-sync" onclick="syncProject()">`) from
  `packages/viewer/index.html`.
- Removed the now-unreferenced `syncProject()` function from `packages/viewer/app.js` (the `Sync
  Project` section, ~40 lines) — confirmed via grep that `btn-sync`/`syncProject` had exactly two
  references total (the button markup and the function itself) before this fix, both removed.
- **Deliberately not building a real `/api/sync` endpoint** — `packages/server` has been kept
  read-only by explicit design since spec 047's hardening; adding a POST endpoint that triggers a
  filesystem re-scan based on a client-supplied project path reopens exactly the write-surface risk
  that hardening closed, for a feature (syncing from the browser instead of the CLI) with no
  established real user need. Removing the dead action is the smaller, safer real fix.

## Out of scope

- Any new HTTP endpoint on `packages/server`.
- `packages/server` authentication — considered and declined for this batch (see spec 054/055's
  shared context and the ROADMAP.md refresh for the full reasoning); this spec only removes a dead
  UI action found while that research was underway, unrelated to the auth decision itself.

## Design

Nothing to design — this is a pure removal of code that called a non-existent endpoint. The
interesting finding is that `app.ts` already documented the "CLI-only" decision in a comment; this
spec closes the gap between that comment and the shipped viewer, which still presented a working-
looking button contradicting it.

## Acceptance criteria

- [x] `packages/viewer/index.html` no longer contains a Sync button.
- [x] `packages/viewer/app.js` no longer contains `syncProject()` or any reference to `/api/sync`.
- [x] `packages/server/src/app.ts` unchanged — still exactly 3 real routes plus the SPA fallback.
- [x] A real `nodum serve` instance's served `app.js`/`index.html` — not just the source files —
      contain no trace of the removed button/function.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

No new automated test file — `packages/viewer` has no existing test suite, and a pure deletion of
dead code has nothing new to assert beyond "the removed thing is gone," which the real end-to-end
check below covers directly. Existing `packages/server` (`app.test.ts`, `project-path.test.ts`) and
`packages/cli` suites verified unmodified and green.

**Real end-to-end (mandatory):** built `packages/cli`/`packages/server` (the server's build step
copies `packages/viewer` into its own served `viewer/` directory), started a real `nodum serve`
instance against this repo's own already-synced project, and:
- `curl`'d the actually-served `/app.js` and `/index.html` — confirmed zero occurrences of
  `syncProject`/`btn-sync`/`api/sync`, not just checked the source files.
- `curl -X POST /api/sync` against the running server — confirmed a real `404 Cannot POST
  /api/sync` (Express's default handler, since no route exists) — this is the exact failure every
  click of the old button silently produced, now that it's gone rather than triggering a real bug.
- `curl /api/projects` — confirmed the server's real, unrelated routes still work normally.

## Success Metrics

- Real check: a real running server + real HTTP requests confirmed the served (not just source)
  assets are clean, and that the removed button would have 404'd on every click before this fix —
  a genuinely broken user-facing action, not a hypothetical one.

## Related

First spec in the v2.12.0 batch (viewer Sync fix, MCP SDK version bump, KMP expect/actual edges).
Found as a side effect of `packages/server` auth research, not the auth work itself — auth was
explicitly considered and declined for this batch.
