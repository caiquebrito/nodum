# 022 — Contribution conventions

## Status: done

Implemented: `CONTRIBUTING.md` written at repo root, `.github/pull_request_template.md` added,
`PUBLISH.md` cross-linked. This spec's own folder moved from `docs/development/active/` to
`docs/development/completed/` as part of this same commit — the first spec to actually use the
`active/` → `completed/` convention it defines. No source files changed, so
`npm run build && npm test --workspaces` is unaffected; re-ran it anyway to confirm (all four
workspaces green, no regressions from the two new files).

## Goal

Write down, in one place, the branching/PR/spec workflow that has existed only as tribal
knowledge (`PUBLISH.md`'s release section, spec 000's Scope, and 21 specs' worth of imitation)
and add a `Feature:`/`Fix:`/`Chore:`/`Docs:`/`Release:` PR title prefix on top of the existing
`<sentence> (spec NNN)` pattern, so a PR's category is visible in a list view without opening it.

## Why now

Kicks off v2.2.0, and v2.2.0 is the first release planned as a batch of specs up front rather
than one spec landing at a time. That breaks a quiet invariant: every one of the 22 specs so far
was written directly into `completed/` in the same commit as its implementation — the folder
name was only ever aspirational in hindsight, never actually false. Planning 8 specs (022–029)
ahead of implementing them needs a place for a written-but-not-yet-done spec to live that isn't
a lie. This spec introduces that place and writes down the rest of the convention at the same
time, since both were going to be documented from scratch regardless.

Also closes a real gap: spec 000's Scope (`docs/development/completed/000-ci-cd-pipeline/spec.md:25`)
promised "add a short CONTRIBUTING.md section (or new file) documenting the branch workflow ...
since none exists today" and that line was never checked off — it's absent from spec 000's own
Acceptance criteria. 22 specs later, it still doesn't exist.

## Scope

- `docs/development/active/` (new directory, this spec's own folder is the first occupant): a
  spec is authored here first. Its implementation PR does `git mv` to `completed/<slug>/` and
  fills in `## Status: done` with real verification evidence, in the same commit as the code.
  `active/` should be empty on `develop` except while a spec is actively being implemented — it
  is not a backlog, just a staging pad for a spec whose PR is open.
- `CONTRIBUTING.md` (new, repo root): the workflow end to end —
  - Branch from `develop`, named `feature/NNN-slug` (or `chore/slug` for non-spec work).
  - Author `docs/development/active/NNN-slug/spec.md`, matching the shape of any file under
    `docs/development/completed/` — `# NNN — Title` (em dash, zero-padded 3 digits),
    `## Status:`, `## Goal`, `## Why now`, `## Scope`, `## Out of scope`, `## Design`,
    `## Acceptance criteria`, `## Test plan`, `## Success Metrics`, `## Related`. No YAML
    frontmatter — the existing 22 specs have none, and this doesn't add any.
  - Implement, with colocated `*.test.ts` files (the project's existing pattern — no separate
    `__tests__/` directories anywhere in `packages/`).
  - `git mv` the spec folder into `completed/`, set `## Status: done` with concrete verification
    (what you ran, what you saw — matching the existing specs' style, not just "tests pass").
  - Add `.changeset/<slug-without-number>.md` if a publishable package (`core`, `cli`, `mcp`,
    `server`) changed; skip it for docs-only or internal-refactor PRs, exactly as `PUBLISH.md`
    already says.
  - One commit: `<Imperative sentence> (spec NNN)` — unchanged from all 19 existing feature
    commits; no prefix added here, only PR titles gain one.
  - Open a PR into `develop` titled `<Type>: <imperative sentence> (spec NNN)`.
- PR title types, in the same sentence-case, colon-separated grammar as the existing
  `chore: ...` commits already use for the prefix word itself:
  - **Feature:** new capability or behavior change.
  - **Fix:** corrects a defect in already-shipped behavior.
  - **Chore:** infra, tooling, docs, dependency, or process work with no user-facing behavior
    change.
  - **Docs:** documentation-only changes to already-correct behavior (rare — most doc updates
    ride along with the Feature/Fix that motivated them).
  - **Release:** the `develop → main` PR that cuts a release — matches the existing
    `"Release v2.1.0: ..."` / `"Release: ... (specs 000, 003)"` pattern, now just consistently
    capitalized as a type.
  - Non-spec PRs (a chore with no spec number) omit `(spec NNN)` entirely — the parenthetical
    only appears when a spec exists.
- `.github/pull_request_template.md` (new): a short checklist mirroring the steps above —
  Summary, Spec (link or "N/A"), What changed, Verification, and a changeset checkbox — so the
  title/spec/changeset convention is prompted for, not just documented in prose someone has to
  go find.
- Cross-link: add one line at the top of `docs/development/PUBLISH.md` pointing to
  `CONTRIBUTING.md` for the day-to-day workflow, since `PUBLISH.md` should stay scoped to the
  release mechanics it already documents well, not duplicate the branching model a second time.

## Out of scope

- Enforcing the title/type convention with a CI check (e.g. a PR-title linter) — this repo's
  existing bar is "documented and followed," matching how the spec-number-in-commit convention
  has held for 22 specs without any automation. Revisit if it drifts.
- Retroactively renaming any of the 32 existing merged PRs — history stays as it is; the
  convention applies going forward from this spec.
- CODEOWNERS or required-review-count changes — spec 000 explicitly left this at 0 required
  reviewers and nothing here changes that.
- A spec template *file* (e.g. `docs/development/TEMPLATE.md`) — `CONTRIBUTING.md` describes the
  shape in prose instead, since copying an existing `completed/` spec has been how every prior
  spec was actually written, and pointing at a live example is more honest than a template that
  would immediately drift from it.

## Design

### 1. `docs/development/active/` (new, empty after this spec merges)

No files besides whatever spec is currently in flight. `.gitkeep` is unnecessary — the directory
is recreated by `mkdir -p` the next time a spec is authored into it, same as any other working
directory; it does not need to exist on `develop` between specs.

### 2. `CONTRIBUTING.md` (repo root, new)

Full contents — see the companion file written alongside this spec. Sections, in order:
`Branching model`, `Writing a spec`, `Implementing it`, `Opening the PR` (title grammar table),
`Changesets`, `Commit messages`.

### 3. `.github/pull_request_template.md` (new)

```markdown
## Summary

<!-- One or two sentences: what does this PR do and why. -->

## Spec

<!-- docs/development/completed/NNN-slug/spec.md, or "N/A" for non-spec work. -->

## What changed

-

## Verification

<!-- Commands run, output observed. `npm run build && npm test --workspaces` is the minimum bar. -->

## Changeset

- [ ] Added (`packages/core`, `cli`, `mcp`, or `server` changed)
- [ ] Not needed (docs-only / internal refactor, no publishable-package behavior change)
```

### 4. `docs/development/PUBLISH.md` — one line added at the top

```markdown
# Releasing Nodum

> For the day-to-day branch → spec → PR workflow, see `CONTRIBUTING.md`. This document covers
> release mechanics only: changesets, cutting a release, and what gets published.

Releases are automated via [Changesets](https://github.com/changesets/changesets) ...
```
(rest of the file unchanged)

## Acceptance criteria

- [x] `CONTRIBUTING.md` exists at repo root and documents the full loop: branch → spec in
      `active/` → implement → move to `completed/` → changeset → commit → PR.
- [x] `.github/pull_request_template.md` exists and renders when opening a PR on GitHub.
- [x] `PUBLISH.md` cross-links `CONTRIBUTING.md` in its first paragraph; no content duplicated
      between the two files.
- [x] This spec's own folder is moved from `docs/development/active/022-contribution-conventions/`
      to `docs/development/completed/022-contribution-conventions/` in the implementation commit,
      dogfooding the convention it defines — same as spec 000 dogfooded the branch model it
      introduced.
- [x] No changeset added — no publishable package changes.

## Test plan

None — this is a documentation/process spec, no source files change. Verified by reading, not
by `*.test.ts`.

## Success Metrics

- Real check: the next spec (023) is authored in `docs/development/active/023-.../spec.md`,
  moved to `completed/` on merge, and its PR is titled with a type prefix — proving the
  convention is followed immediately, not just documented.

## Related

Closes the unshipped `CONTRIBUTING.md` deliverable from `000-ci-cd-pipeline`'s Scope. Blocks
nothing structurally; every other v2.2.0 spec (023–029) follows the convention this one defines.
