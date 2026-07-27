# 000 — CI/CD pipeline: git-flow branching, protected main, automated npm releases

## Status: done (2026-07-27) — `develop` branch created, workflows + Changesets wired up, `npm run build && npm test --workspaces` passing, `npx changeset status` correctly resolving all 4 packages. Manual GitHub-settings steps below still pending your action.

## Goal

Set up a git-flow-style workflow (`develop` for integration, feature branches off `develop`, `develop → main` for releases), protect `main` so it only receives merges via PR, and automate npm publishing so that cutting a release is "merge a PR" rather than a manual `npm publish` from someone's laptop.

## Why now

Numbered outside the v2.1.0 roadmap breakdown (`000-` sorts first) because it's infrastructure the user wants in place going forward for all subsequent spec work — not a roadmap feature itself. Two real, existing problems it also fixes along the way:
- `docs/development/PUBLISH.md` describes publishing the **root** `@caiquebrito/nodum` package directly (`npm publish --access public` from repo root) — stale from before the monorepo split. The actually-installed packages today are the four workspace packages (`nodum-core`, `nodum-cli`, `nodum-mcp`, `nodum-server`), and the root `package.json` (`"private": false`) has no `main`/`files` pointing anywhere coherent. Left as-is, following PUBLISH.md today would publish a broken/empty package.
- There is currently no branch protection on `main` and no CI at all — spec 001/002 landed only because it happened to be reviewed here first; nothing in the repo enforces that.

## Scope

- **Branching model**: `develop` becomes the integration branch (and the GitHub default branch). All feature work branches from `develop` and PRs back into `develop`. Releases happen by opening a `develop → main` PR when the user decides.
- **Branch protection on `main`**: PR-only, no direct pushes, required passing CI status check before merge.
- **Versioning/publishing**: [Changesets](https://github.com/changesets/changesets) — the standard tool for independently-versioned npm monorepos. Contributors add a changeset file (`npx changeset`) describing their bump per PR; a bot-maintained "Version Packages" PR accumulates them; **merging that PR is what triggers the actual npm publish + git tags + GitHub Release**, per your answers above.
- **Two GitHub Actions workflows**:
  - `ci.yml` — build + test on every PR into `develop` or `main`, and on push to `develop`.
  - `release.yml` — runs Changesets' action on push to `main`. If there are unreleased changesets, it opens/updates the "Version Packages" PR. If not (i.e., that PR was just merged), it builds and publishes every changed package to npm, creates git tags (`<package>@<version>` per package, Changesets' standard tag format), and creates GitHub Releases.
- **Root package hygiene**: `package.json` `"private": true` (stop it from ever being an accidental publish target) — the four workspace packages remain the real publish targets, unchanged.
- **Node version bump**: `engines.node` across all `package.json`s from `>=16.0.0` to `>=18.0.0` — Node 16 is long past EOL, and CI needs to pin to a real, current LTS (Node 20).
- **Docs**: rewrite `docs/development/PUBLISH.md` to describe the actual, new flow (delete the stale root-package/manual-tag instructions); add a short `CONTRIBUTING.md` section (or new file) documenting the branch workflow (`develop` → feature branch → PR → `develop`, and how/when release PRs happen) since none exists today.

## Out of scope

- Actually triggering the first release (merging `develop → main`) — you'll do that when ready, per your original ask.
- Required PR review count / CODEOWNERS — left at 0 required reviewers for now (solo-maintained repo currently); easy to add later in GitHub settings without touching this spec's automation.
- Protecting `develop` with the same strictness as `main` — proposed as optional/lighter (PR + CI required, but this is a repo setting you can toggle; not automated by this spec since it doesn't affect the release pipeline itself). Flagging as a recommendation, your call at execution time.
- Auto-generating changesets from commit messages (that's semantic-release's model, not chosen here) — changesets are added manually per PR going forward, starting with the first PR after this lands.

## Design

### Files created

**`.github/workflows/ci.yml`**
```yaml
name: CI
on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test --workspaces
```

**`.github/workflows/release.yml`**
```yaml
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    environment: npm-production   # shows up under repo Deployments — the "release environment" tracking
    permissions:
      contents: write    # to push version-bump commits, tags, and create GH Releases
      pull-requests: write # to open/update the "Version Packages" PR
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - name: Create/update release PR or publish
        uses: changesets/action@v1
        with:
          version: npm run version   # `changeset version` — bumps package.json + CHANGELOGs
          publish: npm run release   # `npm run build && changeset publish`
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**`.changeset/config.json`** (created via `npx changeset init`, then edited):
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```
`access: public` is required — these are scoped `@caiquebrito/...` packages, which npm treats as private by default unless told otherwise. `baseBranch: main` because that's the branch Changesets diffs against to know what's unreleased.

### Root `package.json` changes
```jsonc
{
  "private": true,               // was false — stop root from being publishable
  "engines": { "node": ">=18.0.0" },  // was >=16.0.0, matched in every packages/*/package.json too
  "scripts": {
    // existing scripts unchanged, plus:
    "changeset": "changeset",
    "version": "changeset version",
    "release": "npm run build && changeset publish"
  },
  "devDependencies": {
    // existing, plus:
    "@changesets/cli": "^2.27.0"
  }
}
```

### `docs/development/PUBLISH.md` — rewritten

Replaces the entire manual/stale content with: how to add a changeset (`npx changeset` from a feature branch, before opening the PR into `develop`), how the `develop → main` release PR flow works, what the bot-authored "Version Packages" PR is and why merging it is the actual trigger, and where to watch progress (Actions tab + the `npm-production` environment's deployment history).

## What I'll do vs. what needs you

**I can do via git (no special permissions needed):**
- Create and push the `develop` branch from current `main`.
- Add `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.changeset/config.json`, the root `package.json` changes, the `engines` bump repo-wide, and the rewritten `PUBLISH.md` — all as a PR into `develop` (following the very branching model this spec introduces).

**Needs you, before the pipeline can actually run (I'll give exact steps at implementation time, won't act on these without asking again first — same as the PR-merge classifier block you hit earlier):**
1. **Set `develop` as the GitHub default branch** (Settings → General → Default branch) — or tell me to do it via `gh api`, your call.
2. **Enable branch protection on `main`**: Settings → Branches → Add rule → `main` → require a pull request before merging, require status checks to pass (select the `build-and-test` check once it's run at least once), do not allow bypassing (or allow for yourself as owner — your call), block force pushes and deletion.
3. **Add the `NPM_TOKEN` secret**: `npm token create --read-and-publish` (or via npmjs.com → Access Tokens → Granular, scoped to the `@caiquebrito` org/packages), then Settings → Secrets and variables → Actions → New repository secret → `NPM_TOKEN`.
4. **Create the `npm-production` GitHub Environment** (Settings → Environments → New environment, name it exactly `npm-production`) — optional required-reviewers gate can be added here later if you ever want a manual approval step before publish.

## Acceptance criteria

- [x] `develop` branch exists on origin, branched from current `main`.
- [x] This spec's own implementation PR targets `develop`, not `main` — dogfooding the new model from the first PR onward. (PR #2)
- [x] `npm run build && npm test --workspaces` passes with the `engines` bump and new devDependency.
- [x] `npx changeset --help` runs successfully (package installed and wired).
- [x] `ci.yml` triggers on a test PR into `develop` and reports a status check. (verified: build-and-test passed in 1m23s on PR #2)
- [x] Root `package.json` is `"private": true`.
- [x] `PUBLISH.md` no longer references `npm publish --access public` from repo root or manual `npm version` + tag pushing.
- [x] Clear written handoff (this document's "What needs you" section) covering the 4 manual GitHub-settings steps, since none of them are things I should do unprompted.

## Success Metrics

- The next PR after this one lands can go: feature branch → PR into `develop` → merge → (later) `develop → main` PR → merge → bot opens "Version Packages" PR → you merge it → packages appear on npm with matching git tags, with zero manual `npm publish` commands run by hand.

## Related

Independent of the v2.1.0 numbered task list (001–020) — orthogonal infra. Does not block or get blocked by spec 003 (`file-change-detection`), which resumes after this lands.
