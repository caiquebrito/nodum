# 074 — Xcode: scope honestly

## Status: done (deferred)

**Decision: option 3 — defer.** Xcode gets no new integration this pass; Swift/Objective-C
developers keep the path that already exists (CLI/MCP server in any MCP-speaking editor). This
closes the LSP arc (071-074): every other IDE named in the original ask now has a real path
(071-073), and Xcode's own gap is documented rather than left implicit.

**Why option 3 over 1 or 2, weighed for real, not just listed:**

- **Option 1 (Xcode Source Editor Extension)** would only ever be a manually-invoked menu command
  — no diagnostics API, no persistent background connection, so it can't deliver anything close to
  the passive hover/diagnostics/codeLens experience specs 071-073 already give every other editor.
  Building it would mean shipping a materially worse experience for Xcode specifically, which is
  itself a kind of dishonesty about what "Xcode support" means, even if narrowly true.
- **Option 2 (companion macOS app)** sidesteps Xcode's own constraints entirely by not integrating
  with Xcode at all — but that also means it isn't really "Xcode support," it's a second, separate
  product (a native macOS GUI app, Swift/AppKit or SwiftUI, code-signed and notarized for real
  distribution) built on a completely different stack from the rest of this monorepo. That's a
  real, standalone initiative — disproportionate to what this spec's own framing ("thin, name the
  real constraint") calls for.
- **A constraint specific to how this decision was made, not just to Xcode itself**: neither
  option 1 nor option 2 could be verified for real in this environment even if built — both need a
  real macOS GUI to click through (same class of gap spec 073 hit with VS Code, but with no
  fallback here: spec 073 could at least verify packaging/module-resolution mechanically; an Xcode
  extension's actual behavior inside Xcode has no equivalent headless check, and a native app would
  additionally need Apple Developer signing/notarization this environment has no credentials for).
  Building either blind, with zero way to confirm it works, is a worse outcome than naming the gap
  honestly.

**Interim path (already true today, not new work)**: Swift/Objective-C developers get full nodum
context — search, hover-equivalent context, trace impact, dead-code/cycle detection — via the
existing CLI (`nodum search`/`trace-impact`/etc.) or the MCP server (specs 037-039 already parse
Swift/Objective-C for real) in any MCP-speaking editor: Claude Code, Cursor, Zed, or VS Code with
the extension from spec 073. The gap is specifically "not inside Xcode itself," not "no path at
all."

## Goal

Decide, with real constraints on the table, whether/how nodum reaches Xcode — and record that
decision the same way this project already documents other prerequisite-blocked items (Dart/
Flutter, cross-language duplication, server auth), rather than leaving it silently unaddressed.

## Why now

Every other IDE named in the original ask (Android Studio, Visual Studio, JetBrains, VS Code)
has a path via LSP (specs 071-073). Xcode does not: it has no general-purpose LSP client (Apple's
own tooling uses SourceKit-LSP internally for Swift, but Xcode doesn't expose a way to point it
at a third-party language server) and no MCP client. Promising an Xcode integration without
naming this constraint would repeat the failure mode this whole plan is trying to move away from
(see the v2.5.0 "gate release" precedent in `docs/development/ROADMAP.md` — making claims true
rather than aspirational).

## Scope

Real options, in ascending implementation cost, to evaluate and choose between (not all of them —
this spec's job is to pick one, or explicitly defer):

1. **Xcode Source Editor Extension** (Swift, `XCSourceEditorCommand`) — Apple's supported
   extension mechanism. Real constraints: no diagnostics API (can't show inline warnings the way
   LSP diagnostics do), limited to a command users manually invoke from a menu, no persistent
   background connection to a language server. Would let a user trigger, e.g., "show nodum
   context for this function" as an explicit action, not passive hover/diagnostics.
2. **External companion app / menu-bar tool** — a small macOS app (or CLI-launched utility) that
   runs alongside Xcode and drives the CLI (`nodum search`, `nodum trace-impact`, etc.) against
   the currently-open file, shown in its own window rather than inside Xcode. No Xcode API
   integration at all — sidesteps every Xcode-specific constraint by not integrating with Xcode.
3. **Do nothing further** — Swift/Objective-C developers already have a path today: the existing
   CLI and MCP server work against Swift/ObjC-parsed projects (specs 037-039) in any MCP-speaking
   editor (Claude Code, Cursor, Zed) even if that editor isn't Xcode itself. This is already true
   without any new work.

## Out of scope

Building any of the above speculatively before deciding. This spec's actual deliverable, if the
answer is "defer," is a written decision — updating this file's own Status and the roadmap's
v3.0.0 section to say so explicitly, the same way Dart/Flutter and server auth are already
recorded as deliberately-deferred with reasons, not silently absent.

## Design

N/A — deferred, see decision above.

## Acceptance criteria

- [x] A real decision is made and recorded (in this file and in `docs/development/ROADMAP.md`):
      explicitly deferred, option 3 (do nothing further) as the interim state.
- [x] The roadmap names the concrete blocker (no general LSP client, no MCP client in Xcode) and
      the interim path (CLI/MCP in a non-Xcode editor), matching the tone and specificity of the
      existing Dart/Flutter and server-auth deferrals.
- [ ] (N/A — deferred, not built.)

## Test plan

Deferred — no code. The "test" is that the roadmap accurately reflects reality, verified by
reading `docs/development/ROADMAP.md`'s own updated "Next" and v3.0.0 sections.

## Success Metrics

A closed decision: this spec's status moved from "refined — not started" to "done (deferred)",
with the reasoning and interim path recorded in both this file and `docs/development/ROADMAP.md`
— not left open indefinitely.

## Related

Sibling to spec 073. Same "name the real constraint rather than promise past it" posture as the
roadmap's existing Dart/Flutter and server-auth entries. Closes the LSP arc (071-074).
