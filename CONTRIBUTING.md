# Contributing to Nodum

Nodum is built spec-driven: almost every change of substance starts as a short written spec
under `docs/development/`, lands on a feature branch, and merges into `develop` via PR. This
document is the day-to-day workflow. For release mechanics — changesets, cutting a version,
what gets published where — see `docs/development/PUBLISH.md`.

## Branching model

- `develop` is the integration branch and the GitHub default branch. Branch from it, PR back
  into it.
- `main` is protected and only ever receives `develop → main` release PRs.
- Branch names: `feature/NNN-kebab-slug` for spec-backed work (`NNN` matches the spec folder
  number), `chore/kebab-slug` for everything else (dependency bumps, CI tweaks, doc fixes with
  no spec).

## Writing a spec

Most non-trivial changes get a spec first, written to
`docs/development/active/NNN-slug/spec.md` — `NNN` is the next unused number across both
`active/` and `completed/`, zero-padded to 3 digits. `active/` is a staging pad, not a backlog:
a spec lives there only while its PR is open, and moves to `completed/` in the same commit that
finishes the implementation.

Match the shape of any existing file under `docs/development/completed/` — reading a recent one
is the fastest way to calibrate. There's no separate template file; the completed specs *are*
the template, and a standalone template would only drift from them. The shape:

```markdown
# NNN — Title

## Status: done

<one paragraph: what you ran, what you saw — concrete verification, not just "tests pass">

## Goal
## Why now
## Scope
## Out of scope
## Design
## Acceptance criteria
## Test plan
## Success Metrics
## Related
```

No YAML frontmatter — none of the existing specs use it, and this doesn't introduce it. Small
process-only specs may reasonably stop after `Out of scope`; most code-changing specs use the
full shape.

Skip the spec entirely for genuinely small or mechanical changes — a typo fix, a dependency
bump, a one-line config change. Use judgment; when in doubt, write the short version.

## Implementing it

- Colocate tests: `foo.ts` next to `foo.test.ts`, matching every existing file in `packages/`.
  There's no `__tests__/` convention here.
- When the implementation is done, `git mv` the spec folder from `active/` to `completed/` and
  fill in `## Status: done` with what you actually verified — a specific command and its output,
  or a concrete end-to-end check, the way every existing spec does it.

## Opening the PR

Title grammar: `<Type>: <imperative sentence> (spec NNN)`. Drop `(spec NNN)` for work with no
spec.

| Type | Use for |
|---|---|
| `Feature:` | New capability or behavior change |
| `Fix:` | Corrects a defect in already-shipped behavior |
| `Chore:` | Infra, tooling, dependency, or process work — no user-facing behavior change |
| `Docs:` | Documentation-only changes to already-correct behavior |
| `Release:` | The `develop → main` PR that cuts a release |

Examples:

```
Feature: count real tokens on every MCP context payload (spec 024)
Fix: cap neighbour expansion and untruncated member lists (spec 027)
Chore: bump vitest to 1.6 (no spec)
Release: v2.2.0 — measured token efficiency (specs 022-029)
```

The commit message itself keeps the existing, unprefixed style — `<Imperative sentence> (spec
NNN)` — matching all prior history; only the PR title gains the type prefix.

`.github/pull_request_template.md` prompts for a summary, the spec path, what changed,
verification, and whether a changeset was added — fill it in rather than deleting it.

CI (`build-and-test`) must pass before merge; the repo currently requires 0 approvals, so a
green check is the actual gate.

## Changesets

Add one if a publishable package changed (`packages/core`, `cli`, `mcp`, `server`):

```bash
npx changeset
```

Name the file after the spec's slug without its number — `023-lockstep-versioning` →
`.changeset/lockstep-versioning.md`. Skip it for docs-only or internal-refactor PRs; nothing
enforces this, it's a judgment call same as deciding whether to write a spec at all.

## Commit messages

One commit per PR where practical: `<Imperative sentence> (spec NNN)`, capitalized, no
`feat:`/`fix:` prefix — that distinction lives in the PR title, not the commit, to match all 22
specs' worth of existing history.
