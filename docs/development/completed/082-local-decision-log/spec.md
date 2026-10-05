# 082 — Local decision log: cheap cross-session memory for lost-context recovery

## Status: done

Implemented as designed, no deviations. `packages/core/src/memory/decision-log.ts` gained
`appendDecisionLog`/`readDecisionLog` (most-recent-first markdown bullets in
`<nodumDataDir>/<project>/memory/DECISIONS.md`, capped at `MAX_DECISION_ENTRIES = 50`).
`claude-injector.ts`'s single marker-replace logic was factored into a shared
`upsertMarkerBlock` helper, reused by both the existing `injectCLAUDEContext` (sync-stats block)
and the new `injectLatestNote` (notes block, a second, independent marker pair) — confirming the
Design section's bet that the two blocks never need to know about each other.

Four surfaces, all sharing the same `DECISIONS.md` file: `nodum note <message> [projectPath]` and
`nodum notes [projectPath] [--limit N]` (CLI, `packages/cli/src/commands/note.ts`, resolving
`projectName` exactly as `metrics.ts` already does), and `add_note`/`get_notes` (MCP tools,
`packages/query/src/handlers.ts` + `packages/mcp/src/index.ts`) for the in-session path.

**Real end-to-end check, not simulated**: synced a small real fixture with the real built CLI,
ran `nodum note`, and inspected the real `CLAUDE.md` — both marker blocks (sync-stats and notes)
coexisted correctly. Re-ran `nodum sync`: the notes block survived byte-for-byte unchanged, exactly
as designed. Added a second note and ran `nodum notes`: both entries listed in full via the
read command, while the auto-injected `CLAUDE.md` block kept showing only the single latest entry
— confirming the near-constant per-prompt cost this feature exists to guarantee, regardless of how
many notes accumulate on disk.

Full workspace suite (`npm run build` + `npm test --workspaces` from repo root) green across all
8 workspaces: `packages/core` 622 tests (+10 for `decision-log.test.ts`), `packages/query` 132
(+5 for `handleAddNote`/`handleGetNotes`), `packages/cli` 125 (+6 for `note.test.ts`), `packages/mcp`
18 (its own `registers all 16 tools` pin updated from 14, a disclosed, intentional count change for
the two new tools).

## Goal

Give a Claude Code session a cheap, fully local way to recover "what we decided and what's
in progress" after a context loss (a session restart, a long conversation that had to be
`/clear`ed, a corporate API-key setup where prompt caching can't be relied on to keep a long
transcript cheap) — without the recovery mechanism itself becoming a new source of token bloat.
Today's memory layer (`packages/core/src/memory/`) already persists *structural* facts across
sessions (`SUMMARY.md`'s stack/stats, `activity.md`'s sync history, a `CLAUDE.md` marker block
refreshed on every sync) — but nothing persists *narrative* facts (a decision made, a spec closed,
a thing deliberately deferred). That gap is real and current: this conversation itself is the
motivating case — closing specs 077/078/079 each produced a real, hard-won conclusion with no
local trace a future session could cheaply recover without re-reading `ROADMAP.md`'s multi-
thousand-word prose or re-deriving it from `git log`.

## Why now

Raised directly in this conversation (not roadmap-driven): using nodum on a company machine where
an API-key-billed, possibly-cache-broken corporate LLM proxy makes every token count, and where
long sessions get lost to context limits or `/clear`. The fix that actually addresses the stated
problem — "losing information between commands," cheaply — is a small local file a session can
read for a few hundred tokens instead of either (a) losing the decision entirely or (b) paying to
re-send/re-derive it. This is deliberately scoped as the minimal version of that: a flat, capped,
append-only log — not a redesign of nodum's memory system, not a replacement for `SUMMARY.md`'s
existing "Manual Notes"/"Architecture Notes" sections (which are for stable architectural facts,
hand-edited, not timestamped running history).

## Scope

1. **`packages/core/src/memory/decision-log.ts`** — `appendDecisionLog(memoryDir, text)` and
   `readDecisionLog(memoryDir, limit?)`, mirroring `activity-log.ts`'s shape (most-recent-first,
   timestamped markdown bullets, `<nodumDataDir>/<project>/memory/DECISIONS.md`) but capped at the
   most recent **50 entries** — older entries are silently dropped on write, not left to grow
   unbounded. The cap exists for the same reason this whole feature exists: unbounded local state
   that eventually gets fully re-read defeats its own purpose.
2. **`nodum note <message> [projectPath]`** CLI command (`packages/cli/src/commands/note.ts`) —
   resolves `projectName` from `projectPath` exactly as `metrics.ts` already does
   (`basename(resolve(projectPath))`), appends via `appendDecisionLog`, then refreshes a *second*,
   independent marker block in the project's `CLAUDE.md`
   (`<!-- nodum:notes:start -->...<!-- nodum:notes:end -->`, separate from the existing
   `<!-- nodum:start -->` sync-stats block) showing **only the single latest entry** plus a pointer
   to the full file path — deliberately not the whole log, so the per-prompt injected cost stays
   near-constant regardless of how many notes accumulate. Works independently of `nodum sync` — a
   note shouldn't require a full resync to surface.
3. **`nodum notes [projectPath] [--limit N]`** CLI command (read-only, default `N=10`) — prints the
   most recent entries, for a human or an agent deliberately pulling full history at the start of a
   session (opt-in, bounded by `N`), mirroring `nodum metrics`'s existing read-command shape.
4. **Two MCP tools** (`packages/query/src/handlers.ts` + registered in `packages/mcp/src/index.ts`):
   `add_note(project_name, text)` and `get_notes(project_name, limit?)` — the in-session path (an
   agent mid-conversation can record a decision or recover history without shelling out to the
   CLI), same underlying `decision-log.ts` functions as the CLI commands.

## Out of scope

- Any change to `SUMMARY.md`'s existing "Manual Notes"/"Architecture Notes" sections — those stay
  hand-edited, stable-fact sections; this is a separate, timestamped, append-only running log.
- Auto-generating notes from git history, PR descriptions, or anything else — this is a manual
  (or agent-invoked) note, the same "you or Claude decides what's worth recording" posture
  `CONTRIBUTING.md`'s own spec-writing process already uses.
- Injecting the *full* decision history into `CLAUDE.md` automatically — explicitly rejected (see
  Design) as counter to this feature's own purpose.
- Any cross-project aggregation (a "notes across all my projects" view) — scoped to one project's
  log at a time, matching every other project-scoped nodum command.
- Fixing corporate-proxy prompt-cache stripping itself — out of reach from inside this codebase;
  this spec addresses the token-cost symptom that's actually controllable (how much context a
  session needs to recover or resend), not the proxy.

## Design

### Why cap at 50, and why only the latest entry gets auto-injected

The whole point of this feature is reducing token cost, not adding a new unbounded one. An
uncapped log that eventually gets dumped in full into every `CLAUDE.md`-reading session would
grow into exactly the problem it's meant to solve. Two independent bounds enforce this:
`appendDecisionLog` trims the on-disk file to the last 50 entries on every write (a hard disk-size
and worst-case-read bound), and the auto-injected `CLAUDE.md` block only ever shows the single most
recent entry (a few hundred tokens' pointer, not a history dump) — full history is always an
opt-in pull (`nodum notes --limit N` or the `get_notes` MCP tool), never a forced push into every
prompt.

### A second, independent marker block, not a reuse of the sync-stats one

`claude-injector.ts`'s existing `<!-- nodum:start -->` block is rewritten wholesale on every
`nodum sync` from fresh `Graph`/`ProjectAnalysis` data — it has no notion of a note taken between
syncs. Reusing it would mean a note either waits for the next sync to surface (defeats the
"recover quickly" goal) or forces `nodum note` to carry sync-shaped data it doesn't have. A second,
independently-updated marker pair, written only by `nodum note`/`add_note` and left untouched by
`nodum sync`, avoids both: notes surface immediately, and a sync never clobbers the latest note (or
vice versa) since the two blocks' start/end markers never overlap.

### Reusing `metrics.ts`'s project-name resolution exactly

`basename(resolve(projectPath))` is already the established convention for every project-scoped
CLI command that takes a directory (`metrics`, `architecture`, `dead-code`, `complexity`, ...) —
`note`/`notes` follow it unchanged rather than inventing a new resolution rule.

## Acceptance criteria

- [x] `nodum note "closed spec 079, not viable"` from inside a synced project directory appends a
      timestamped entry to `<nodumDataDir>/<project>/memory/DECISIONS.md` and updates the project's
      `CLAUDE.md` notes marker block to show that entry.
- [x] A 51st note silently drops the oldest entry — `DECISIONS.md` never exceeds 50 entries.
- [x] `nodum notes` prints the 10 most recent entries by default; `--limit N` changes the count.
- [x] Running `nodum note` without a prior `nodum sync` for that project still works (creates
      `memory/` if needed) — matches `appendActivityLog`'s existing "create dir if missing" posture.
- [x] `nodum sync` run after `nodum note` does not remove or revert the notes marker block — the
      two marker pairs are independent.
- [x] `add_note`/`get_notes` MCP tools round-trip the same `DECISIONS.md` file the CLI commands use
      — a note added via one surface is visible via the other.

## Test plan

- `packages/core/src/memory/decision-log.test.ts`: append/read round-trip, the 50-entry cap (write
  51, assert the oldest is gone and the newest 50 remain), create-dir-if-missing, malformed/missing
  file tolerance (mirroring `activity-log.ts`'s silent-fail posture).
- `packages/cli/src/commands/note.test.ts`: project-name resolution from a path, marker-block
  update behavior (independent of the existing sync-stats block), `--limit` on `nodum notes`.
- `packages/query/src/handlers.test.ts`: `add_note`/`get_notes` against a real temp `DECISIONS.md`,
  confirming the CLI and MCP surfaces share state (not two independent stores).
- Real check: `nodum sync` a small real fixture, run `nodum note`, inspect the real `CLAUDE.md` for
  both marker blocks coexisting, re-run `nodum sync`, confirm the notes block survives unchanged.

## Success Metrics

Not a ranking/retrieval or `tokensPerCorrectAnswer` change — no `retrieval-eval.ts`/
`benchmarks/harness.ts` before/after applies (this is a new capability, not a change to existing
ranking/rendering). Success is qualitative and bounded: a real note survives a `/clear`-sized
context loss and costs a near-constant few hundred tokens to recover, verified by inspecting the
real injected `CLAUDE.md` block size regardless of how many notes have accumulated on disk.

## Related

- `packages/core/src/memory/activity-log.ts` — the shape this spec's `decision-log.ts` mirrors
  (timestamped, most-recent-first markdown bullets).
- `packages/core/src/memory/claude-injector.ts` — the existing single marker-block mechanism this
  spec adds a second, independent instance of.
- `packages/cli/src/commands/metrics.ts` — the project-name-resolution and read-command-shape
  template this spec's `note`/`notes` commands follow.
- This conversation's own discussion of company-proxy token cost and cross-session context loss —
  the real motivating case, not a roadmap-driven item.
