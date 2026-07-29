# 046 — Housekeeping cleanup

## Status: done

Implemented and verified. Full workspace build/test suite green after deletion (640 tests, no
regression — nothing referenced the deleted paths). First of four specs in the v2.10.0 batch.

## Goal

Clear the small backlog of stale-file and cosmetic-version items ROADMAP.md's Housekeeping section
had been carrying, confirmed still present via v2.10.0's scoping research.

## Why now

Cheapest, lowest-risk work in the batch — ships first, matching this project's practice of
sequencing the safest work first within a release.

## Scope

- **Deleted the git-tracked root-level `/viewer/` directory.** Confirmed via `diff` against
  `packages/viewer/` that all three files (`app.js`, `index.html`, `style.css`) had diverged — the
  root copy was missing spec 036's Swift/ObjC node-color additions and had partially
  Portuguese-localized UI strings the maintained copy doesn't have. Confirmed via grep that nothing
  references the root path specifically: `packages/server/package.json`'s build step
  (`rm -rf viewer && cp -R ../viewer viewer`) already resolves `../viewer` to the sibling
  `packages/viewer`, not the root — verified by running a real `npm run build --workspace=packages/server`
  after deletion and diffing the copied output against `packages/viewer/app.js` (byte-identical).
- **Deleted `claude skills/sync-rag/`** — an abandoned v0 Python artifact with hardcoded personal
  paths. Confirmed via grep that nothing outside its own file and ROADMAP.md's own housekeeping
  note referenced it.
- **Bumped the root `package.json`'s `"version"` field** from stale `"2.4.0"` to `"2.9.0"` (the
  real, current lockstep package version at the time of this spec). The field is cosmetic —
  `"private": true`, never published — but a stale number here is confusing to anyone reading it
  directly.
- **Root `CHANGELOG.md`** was checked and found already reconciled: it explicitly scopes itself to
  pre-v2.1.0 history and defers to `packages/*/CHANGELOG.md` (Changesets-generated) from v2.1.0
  onward, with an empty, intentional `[Unreleased]` section. No change needed — confirmed, not
  assumed.

## Out of scope

- Any further `package.json`-version-reconciliation automation (e.g. a script keeping the root
  version in sync with the packages going forward) — a one-time fix, not infrastructure.

## Acceptance criteria

- [x] Root `/viewer/` no longer present; `packages/server`'s build still produces a correct,
      up-to-date `packages/server/viewer/` from `packages/viewer/` (verified byte-identical).
- [x] `claude skills/sync-rag/` no longer present.
- [x] Root `package.json`'s version reads `2.9.0`.
- [x] `npm run build && npm test --workspaces` green — no regression from either deletion.

## Test plan

No new automated tests needed — this is a deletion/version-bump spec. Verification is the full
existing build+test suite passing unmodified after the change, which is the actual test that
matters here (proves nothing depended on the deleted paths).

## Success Metrics

- `npm run build --workspaces` (all 4 packages) green, including a real `packages/server` build
  producing the correct viewer output post-deletion (checked by diffing the copied files against
  `packages/viewer/`'s source, not just checking the build didn't error).
- Full `npm test --workspaces` — 640 tests, unchanged from pre-spec baseline.

## Related

First of four specs in the v2.10.0 batch (housekeeping, server hardening, near-duplicate
detection, Kotlin source-set labeling). No dependency on or shared code with the other three.
