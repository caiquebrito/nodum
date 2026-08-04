# 074 — Xcode: scope honestly

## Status: refined — not started

Fully designed, not yet branched. Expected outcome of this spec is a **documented decision to
defer**, not an implementation — see Goal.

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

N/A pending the decision above.

## Acceptance criteria

- [ ] A real decision is made and recorded (in this file and in `docs/development/ROADMAP.md`):
      build option 1, build option 2, or explicitly defer with option 3 as the interim state.
- [ ] If deferred: the roadmap names the concrete blocker (no general LSP client, no MCP client
      in Xcode) and the interim path (CLI/MCP in a non-Xcode editor), matching the tone and
      specificity of the existing Dart/Flutter and server-auth deferrals.
- [ ] If built: normal spec acceptance criteria apply, scoped to whichever option was chosen.

## Test plan

Depends on the decision. If deferred, no code — the "test" is that the roadmap accurately
reflects reality (verifiable by reading it).

## Success Metrics

A closed decision, either way, replacing this spec's "refined — not started" status with either
"done" (if built) or an explicit "deferred, see ROADMAP.md" resolution — not left open
indefinitely.

## Related

Sibling to spec 073. Same "name the real constraint rather than promise past it" posture as the
roadmap's existing Dart/Flutter and server-auth entries.
