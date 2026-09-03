# Releasing Nodum

> For the day-to-day branch → spec → PR workflow, see [`CONTRIBUTING.md`](../../CONTRIBUTING.md). This document covers release mechanics only: changesets, cutting a release, and what gets published.

Releases are automated via [Changesets](https://github.com/changesets/changesets) and GitHub Actions. There is no manual `npm publish` step — publishing happens by merging PRs.

## Branching model

- `develop` is the integration branch and the GitHub default branch. All feature work branches off `develop` and PRs back into `develop`.
- `main` is protected (PR-only, no direct pushes) and only ever receives `develop → main` PRs, opened when it's time to cut a release.
- Pushing to `main` is what the release automation watches — see below.

## Adding a changeset

Every PR that changes a publishable package (`packages/core`, `packages/cli`, `packages/mcp`, `packages/query`, `packages/server`) should include a changeset describing the bump:

```bash
npx changeset
```

This walks you through: which package(s) changed, whether it's a `patch`/`minor`/`major` bump, and a one-line summary for the changelog. It writes a small markdown file under `.changeset/` — commit it as part of your PR into `develop`.

If a PR doesn't touch anything user-facing (docs, internal refactor with no published-package behavior change), it's fine to skip adding a changeset — nothing forces one.

## Cutting a release

1. When you're ready to release what's accumulated on `develop`, open a PR: `develop → main`.
2. Merging that PR pushes to `main`, which triggers `.github/workflows/release.yml`.
3. That workflow finds the changesets merged in and opens (or updates) a bot-authored **"Version Packages" PR** directly against `main` — it bumps each changed package's `version` in `package.json`, updates its `CHANGELOG.md`, and consumes the changeset files.
4. Review that PR (it's just a diff of version numbers + changelog entries), then **merge it**. That merge is the actual publish trigger:
   - Each changed package is built and published to npm (`access: public`, scoped under `@caiquebrito/`).
   - A git tag is created per published package (`<package-name>@<version>`, Changesets' standard format).
   - A GitHub Release is created.
5. Watch progress under the repo's **Actions** tab, and under **Deployments** for the `npm-production` environment (release history at a glance).

## What gets published

The five workspace packages, each independently versioned but bumped in lockstep (see the
`fixed` group in `.changeset/config.json`):

| Package | What it is |
|---|---|
| `@caiquebrito/nodum-core` | Graph generation / analysis engine |
| `@caiquebrito/nodum-cli` | `nodum` CLI |
| `@caiquebrito/nodum-mcp` | MCP server for Claude integration |
| `@caiquebrito/nodum-query` | Transport-neutral search/context logic (used by `nodum-mcp`) |
| `@caiquebrito/nodum-server` | 3D visualizer HTTP server |

`packages/lsp` (`@caiquebrito/nodum-lsp`) and `packages/vscode-extension` (`nodum-vscode`) are
`"private": true` and not published to npm — they're distributed separately (built from source /
bundled as a `.vsix`), see [`docs/guides/LSP-SETUP.md`](../guides/LSP-SETUP.md).

The root `@caiquebrito/nodum` package is `"private": true` and is never published — it's just the monorepo workspace root.

## One-time setup (already done, documented for reference)

- `NPM_TOKEN` repository secret — an npm auth token with publish rights to the `@caiquebrito` scope (`npm token create --read-and-publish`), added under Settings → Secrets and variables → Actions.
- `RELEASE_PAT` repository secret — a fine-grained PAT (repo-scoped to `caiquebrito/nodum`, `Contents: Read and write` + `Pull requests: Read and write`), used by `release.yml` instead of the default `GITHUB_TOKEN`. Needed because GitHub's anti-recursion guard means pushes made with the default token never trigger other workflows — without this, the bot-authored "Version Packages" PR never gets a CI run and sits permanently blocked by `main`'s required `build-and-test` check, forcing an admin bypass on every release. Rotate by generating a new token and re-running `gh secret set RELEASE_PAT`.
- `npm-production` GitHub Environment — Settings → Environments — used purely for release visibility (Deployments tab); no required reviewers by default.
- Branch protection on `main` — PR required, status checks required, no direct pushes.

## Testing a package locally before it's released

```bash
cd packages/cli   # or whichever package
npm run build
npm pack
# inspect the tarball
tar -tzf caiquebrito-nodum-cli-*.tgz

# install it somewhere else to smoke-test
mkdir /tmp/test-nodum && cd /tmp/test-nodum
npm install /path/to/caiquebrito-nodum-cli-*.tgz
npx nodum status
```
