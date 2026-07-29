# 058 — Preserve the real stack trace on `nodum sync` failures

## Status: done

Implemented and tested (1 new regression test). Full `packages/cli` suite green (102 tests). Real
check: forced a real sync failure end-to-end and confirmed the actual underlying stack trace — not
just a bare message — now prints to the terminal.

## Goal

Stop discarding the real stack trace when `nodum sync` fails, so investigating a real crash (like
the still-open "Maximum call stack size exceeded" bug from spec 056) no longer requires re-running
a multi-hour real-project sync just to find out where it happened.

## Why now

ROADMAP.md's "Known issue" entry (from spec 056's real verification) named this directly as the
first concrete step for investigating the stack-overflow bug found on Node 22: `packages/cli/src/
commands/sync.ts` already attached the original error as `.cause` on its wrapped error, but nothing
ever printed it — `packages/cli/src/bin/nodum.ts`'s `sync` command's catch block only ever logged
`error.message`. The real stack trace technically existed in memory for the length of that one
process, but was never surfaced anywhere a person could see it.

## Scope

- `sync.ts`: when wrapping a failure, appends the original error's real `.stack` onto the wrapped
  error's own `.stack` (prefixed `Caused by:`) — not just attaching it via `.cause`, which nothing
  downstream was reading. A single `console.error(error.stack)` at the top level now surfaces the
  whole chain without the caller needing to know to check `.cause` separately.
- `bin/nodum.ts`'s `sync` command's catch block: prints `error.stack` (when present) after the
  existing concise message line.
- **Deliberately scoped to the `sync` command only**, not every command's catch block in
  `bin/nodum.ts` — this is a targeted fix for the specific investigation this was blocking, not a
  general error-handling overhaul across the whole CLI.

## Out of scope

- Any other CLI command's error handling.
- Actually diagnosing or fixing the "Maximum call stack size exceeded" bug itself — this spec only
  removes the blocker (no stack trace) that was making that investigation expensive; the next real
  step is re-running against the real project that triggers it and reading the now-visible stack.

## Design

Nothing structurally new — `sync.ts` already had the right instinct (preserve the original error via
`.cause`), it just wasn't wired to anything that displayed it. Appending onto `.stack` directly
(rather than only relying on `.cause`) means the fix works with a plain `console.error(error.stack)`
at the call site, matching what a person actually runs when debugging a CLI failure, instead of
requiring bespoke `.cause`-aware error printing.

## Acceptance criteria

- [x] A real `nodum sync` failure prints the original error's real stack trace, not just a message.
- [x] The existing `cause: original` contract (`sync.test.ts`) is preserved unchanged.
- [x] `npm run build && npm test --workspaces` green.

## Test plan

New regression test in `sync.test.ts`: mocks a rejection with a known fake stack trace and asserts
the thrown wrapped error's `.stack` contains both the `Caused by:` marker and the original stack's
real content.

**Real end-to-end (mandatory):** ran `nodum sync` against a real nonexistent path — confirmed the
terminal output now includes the full real chain: the wrapped error's own throw site in
`sync.ts`/`bin/nodum.ts`, followed by `Caused by:` and the real originating stack from
`core/src/sync.ts`, exactly the information needed to diagnose a real failure without re-running an
expensive sync blind.

## Success Metrics

- Real check: a real CLI failure's terminal output was inspected directly, confirming the fix works
  as a person would actually experience it, not just as a unit-testable object shape.

## Related

Directly unblocks the next investigation step for the "Maximum call stack size exceeded" bug
documented in ROADMAP.md's "Known issue" entry (found during spec 056, v2.13.0).
