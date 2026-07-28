# 023 — Lockstep package versioning

## Status: done

Verified via `npx changeset status`: with the `fixed` group in place, a throwaway
`@caiquebrito/nodum-core: patch` changeset resolved to all four packages moving to `2.4.1`
together (`nodum-core`, `nodum-cli`, `nodum-mcp`, `nodum-server` — even though `mcp` was at
2.2.0 and `server` at 2.0.3 beforehand), confirming the lockstep behavior works before removing
the test changeset. `npm run build && npm test --workspaces` unaffected (297 tests, no source
files touched).

## Goal

Make a release version mean one thing across the whole repo. Today `"v2.1.0"` corresponds to no
git tag and no package version anywhere — Changesets versions the four workspace packages
independently (`fixed: []`, `linked: []` in `.changeset/config.json`), so `core`/`cli` sit at
`2.4.0` while `mcp` is at `2.2.0` and `server` is at `2.0.3`. Planning a `v2.2.0 → v3.0.0` release
train on top of that would keep reproducing the confusion already visible in
`docs/development/ROADMAP.md`, which marks v2.1.0 "Shipped" in one section while its own Success
Metrics section still lists v2.1 as unstarted.

## Why now

First spec of the v2.2.0 batch that touches anything outside documentation, and every later spec
in this release (024–029) will add changesets — better to fix how those changesets resolve
before they accumulate under the old independent-versioning config.

## Scope

- `.changeset/config.json`: move all four publishable packages into a single `fixed` group, so
  every release bumps all four to the *same* version number in one Changesets run, regardless of
  which of them actually changed. `linked` is deliberately not used — it only aligns packages
  that happen to change together, which is exactly the independent-drift behavior this spec is
  correcting.
- Root `package.json` `"version"`: `1.1.1` → `2.4.0`. The root package is `"private": true` and
  never published, so this field has no functional effect — but leaving it frozen at a
  pre-monorepo-split number next to four packages at 2.x is actively misleading to anyone
  reading the file. Aligned to the current highest published version as a marker of repo state,
  not a claim about what gets released next.
- Root `CHANGELOG.md`: currently stops with an "Unreleased" section describing the spec-001
  embeddings fix, which actually shipped in `core@2.2.2` — nothing from specs 002–021 was ever
  added. Rather than hand-backfill 20 specs' worth of entries that the per-package
  `packages/*/CHANGELOG.md` files (Changesets-generated, already accurate) already cover,
  reframe the root file as historical (pre-monorepo, v1.0.0–v2.0.0) and point forward to the
  per-package changelogs as the source of truth from v2.1.0 on.
- `docs/INDEX.md`: refresh the "Last updated / Version" footer.
- `docs/development/LAUNCH.md`: still frames the product as pre-launch at v1.1.1
  ("Status: READY TO LAUNCH", a Hacker News/Product Hunt plan, a "Final Checklist Before
  Launch"). The product has been public on npm since that was written and versions have moved to
  2.4.0. Mark it archived in place — a status banner, not a rewrite — since its content is a
  historical artifact of a launch that already happened, not active planning.
- `README.md`:
  - Line 454: `[ROADMAP.md](./ROADMAP.md)` is a broken relative link — the file lives at
    `docs/development/ROADMAP.md`. Fix the path.
  - Line 500 FAQ: *"Can I self-host the MCP server? A: Not yet. v2 will support self-hosting."*
    — v2 shipped without that feature; the promise is now simply wrong. Correct it to state
    current reality (local-only, no self-hosting yet) without repeating a version promise that
    already broke once.

## Out of scope

- Choosing or announcing the actual next release number. Changesets computes it from the
  highest current version in the `fixed` group plus whatever bump types accumulate across
  024–029's changesets — see Design for why this will very likely **not** literally be
  `2.2.0`, even though that's the roadmap's label for this batch of specs.
- Retroactively re-tagging or re-publishing `mcp`/`server` to "catch up" to `core`/`cli`'s
  2.4.0 — the next real release does that naturally once `fixed` takes effect; no manual
  version surgery.
- Rewriting `docs/development/ROADMAP.md` itself to fix its v2.1.0 status contradiction — that
  document is being superseded by the v2.2.0→v3.0.0 roadmap this spec batch implements; not
  worth editing a document mid-replacement.

## Design

### 1. `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [
    [
      "@caiquebrito/nodum-core",
      "@caiquebrito/nodum-cli",
      "@caiquebrito/nodum-mcp",
      "@caiquebrito/nodum-server"
    ]
  ],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**A real consequence worth stating plainly**: with `fixed` active, the next release bumps *all
four* packages to whatever version Changesets computes from the current maximum (`2.4.0`) plus
the accumulated bump types across every changeset merged before the release PR — most of specs
024–029 are `minor` changes, so the actual published version will likely land at `2.5.0`, not
`2.2.0`. The roadmap's "v2.2.0" label was chosen before this constraint was checked against the
real, already-diverged package versions. Going forward — from whatever this release actually
gets tagged — every subsequent release's roadmap label and its real npm/git-tag version will be
the same number, because `fixed` keeps all four packages moving together from here on. This
release is the one-time reconciliation; nothing to do about it now beyond naming it honestly
when it ships.

### 2. Root `package.json`

```diff
- "version": "1.1.1",
+ "version": "2.4.0",
```

### 3. Root `CHANGELOG.md`

Replace the `## [Unreleased]` section with a pointer, and mark the historical entries as such:

```markdown
## [Unreleased]

_(nothing — this root changelog is retained for history; see below)_

---

### A note on this file

This changelog covers the pre-monorepo and early-monorepo history (v1.0.0 through v2.0.0). From
v2.1.0 onward, each package is versioned and changelogged independently by
[Changesets](https://github.com/changesets/changesets) — see `packages/core/CHANGELOG.md`,
`packages/cli/CHANGELOG.md`, `packages/mcp/CHANGELOG.md`, and `packages/server/CHANGELOG.md` for
the accurate, per-release record. The embeddings fix previously listed here as "Unreleased"
shipped in `@caiquebrito/nodum-core@2.2.2` (spec 001).

---

## [2.0.0] - 2026-05-31
...
```
(rest of file unchanged below this point)

### 4. `docs/INDEX.md` — footer

```diff
-**Last updated:** 2026-05-31 | **Version:** 2.0.0
+**Last updated:** 2026-07-28 | **Version:** 2.4.0 (pre-lockstep; see CONTRIBUTING.md)
```

### 5. `docs/development/LAUNCH.md` — archival banner

```markdown
# 🚀 Nodum Launch Guide

> **Archived.** Written pre-launch at v1.1.1; the launch it describes already happened and
> Nodum has since shipped through v2.4.0. Retained for historical reference only — not an
> active plan.

## Status: READY TO LAUNCH ✅
...
```
(rest of file unchanged below the banner)

### 6. `README.md`

```diff
-See [ROADMAP.md](./ROADMAP.md) for full details.
+See [ROADMAP.md](./docs/development/ROADMAP.md) for full details.
```

```diff
 **Q: Can I self-host the MCP server?**
-A: Not yet. v2 will support self-hosting. Currently: local only.
+A: Not yet — local only for now. Self-hosting isn't on the near-term roadmap; the MCP server is
+   designed to run alongside your own Claude Code session, not as a shared service.
```

## Acceptance criteria

- [x] `.changeset/config.json` has all four packages in one `fixed` group; `npx changeset
      status` still resolves all four packages without error.
- [x] Root `package.json` version reads `2.4.0`.
- [x] Root `CHANGELOG.md` clearly marks itself historical and points to the per-package
      changelogs; no content deleted, only reframed.
- [x] `docs/INDEX.md` footer reflects the current date and version.
- [x] `docs/development/LAUNCH.md` has an archival banner and is otherwise untouched.
- [x] `README.md`'s `ROADMAP.md` link resolves to a real file; the self-hosting FAQ answer no
      longer repeats a broken promise.
- [x] `npm run build && npm test --workspaces` unaffected (no source files touched).

## Test plan

None — config and documentation only, no source files change.

## Success Metrics

- Real check: `npx changeset status` (or a dry-run `npx changeset version` on a scratch clone)
  shows all four packages moving together at the same target version once a changeset exists.

## Related

Independent of 022. Every later spec in this batch (024–029) adds a changeset that now resolves
under this `fixed` config rather than the prior independent one.
