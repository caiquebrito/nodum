# 005 — `nodum config`: real `.gitignore` support + include/exclude patterns

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (core 30/30 incl. new scan-config.test.ts + extended file-discovery.test.ts, cli 5/5 incl. new config.test.ts), and real end-to-end checks: gitignored dir + phantom .rs file both correctly excluded from a fresh sync, nodum config shows the correct resolved extension list (.go/.rs/.rb gone), --set-exclude and --set-include both verified to actually change what nodum sync counts, and exclude-wins-over-include confirmed (gitignored dir stays excluded even when include patterns would otherwise match it)

## Goal

Two real, currently-broken things about file discovery, plus the CLI command the roadmap asks for to control it:

1. `.gitignore` is never consulted. Discovery only skips a hardcoded list of common directory *names* (`node_modules`, `dist`, etc). Anything gitignored but not on that list — build output in an unusual location, a local secrets file, a huge generated directory — gets scanned anyway.
2. `SUPPORTED_EXTENSIONS` in `file-discovery.ts` lists `.go`, `.rs`, `.rb` — but no parser exists for any of them (only TypeScript, JavaScript, Python, Kotlin, Java are registered). These files get discovered, hashed, and counted in `stats.files`, while silently contributing zero nodes/edges — a project with Go or Rust code gets a misleadingly inflated file count with nothing to show for it.
3. No way to customize what gets scanned beyond editing source. `nodum config` gives users include/exclude patterns.

## Why now

`ignore` (the npm package, gitignore-pattern-matching) has been a declared dependency of `@caiquebrito/nodum-core` since before this SDD process started — and is imported nowhere. It's dead weight that was clearly meant to back real `.gitignore` support and never got wired up.

## Scope

- `packages/core/src/scan-config.ts` (new) — `.nodumrc.json` loading, `.gitignore` loading, and a combined file matcher built on the `ignore` package.
- `packages/core/src/file-discovery.ts` — `walkFiles` (the shared walker from spec 004) takes a matcher and applies it to both directories (skip recursing into excluded ones) and files (skip excluded files, in addition to the existing extension filter). `SUPPORTED_EXTENSIONS` is deleted as a hardcoded list and instead derived from the registered parsers' own `.extensions` — the single real fix for problem #2, structured so it can't drift again.
- `packages/cli/src/bin/nodum.ts` — new `nodum config [projectPath]` command: no flags shows the resolved effective configuration; `--set-include`/`--set-exclude` write to `.nodumrc.json`.

## Out of scope

- Nested `.gitignore` files (one per subdirectory, git's real behavior) — only the project-root `.gitignore` is read. Flagging as a known simplification, not fixing here.
- `.gitignore`-syntax edge cases beyond what the `ignore` package itself handles (it's a well-tested, widely-used implementation — not reimplementing anything).
- Any interactive setup wizard — that's `nodum init` (spec 007). `nodum config` here is flag-driven only.
- Migrating existing `~/.nodum/<project>/` cached data when scan config changes — the next `nodum sync` (incremental or not) just reflects the new rules; nothing needs cleanup.

## Design

**`packages/core/src/scan-config.ts`** (new):

```ts
export interface ScanConfig {
  include?: string[]; // glob/gitignore-syntax patterns — if set, ONLY matches are scanned
  exclude?: string[]; // glob/gitignore-syntax patterns, applied in addition to .gitignore
}

export async function loadScanConfig(rootPath: string): Promise<ScanConfig> {
  // reads `${rootPath}/.nodumrc.json`; returns {} if absent or malformed
}

export async function saveScanConfig(rootPath: string, config: ScanConfig): Promise<void> {
  // merges into and writes `${rootPath}/.nodumrc.json`
}

export type FileMatcher = (relativePath: string) => boolean; // true = include

export async function buildFileMatcher(rootPath: string, config: ScanConfig): Promise<FileMatcher> {
  // 1. new Ignore() seeded from `${rootPath}/.gitignore` (if present) + config.exclude
  // 2. if config.include is non-empty, a second Ignore() seeded from config.include —
  //    a path "matches" the include set the same way it'd "match" an ignore set
  // 3. returns (path) => !excludeRules.ignores(path) && (includeRules ? includeRules.ignores(path) : true)
}
```

**`packages/core/src/file-discovery.ts`**:

- `SUPPORTED_EXTENSIONS` deleted; replaced with `getAvailableParsers().flatMap(p => p.extensions)` collected into a `Set` once at module load — the extension allowlist can now only ever be as broad as what's actually parseable.
- `walkFiles(currentPath, rootPath, matcher, visit)` — matcher applied to directory entries (skip the recursive call entirely if excluded, avoiding wasted `readdir` calls into e.g. a large gitignored directory) and to file entries alongside the existing extension check.
- `discoverFiles(rootPath)` and `discoverChangedFiles(rootPath, previousManifest)` both: `const config = await loadScanConfig(rootPath); const matcher = await buildFileMatcher(rootPath, config);` once at the top, then pass `matcher` into `walkFiles`.

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('config [projectPath]')
  .description('Show or update scan configuration (include/exclude patterns)')
  .option('--set-include <patterns>', 'Comma-separated patterns — only matching files are scanned')
  .option('--set-exclude <patterns>', 'Comma-separated patterns to exclude, in addition to .gitignore')
  .action(async (projectPath, options) => {
    const target = resolve(projectPath || process.cwd());
    if (options.setInclude || options.setExclude) {
      const update: ScanConfig = {};
      if (options.setInclude) update.include = options.setInclude.split(',').map(s => s.trim());
      if (options.setExclude) update.exclude = options.setExclude.split(',').map(s => s.trim());
      await saveScanConfig(target, update);
      console.log(`✅ Updated ${target}/.nodumrc.json`);
    }
    const config = await loadScanConfig(target);
    const hasGitignore = existsSync(join(target, '.gitignore'));
    console.log(`\n📋 Scan configuration for ${target}\n`);
    console.log(`  .gitignore honored: ${hasGitignore ? 'yes' : 'no (.gitignore not found)'}`);
    console.log(`  Include patterns: ${config.include?.join(', ') || '(none — scanning everything not excluded)'}`);
    console.log(`  Exclude patterns: ${config.exclude?.join(', ') || '(none beyond .gitignore + built-in defaults)'}`);
    console.log(`  Supported extensions: ${[...getAvailableParsers().flatMap(p => p.extensions)].join(', ')}`);
  });
```

## Acceptance criteria

- [x] A file matched by the project's `.gitignore` is not discovered or counted, without needing any `.nodumrc.json`.
- [x] `.go`/`.rs`/`.rb` files are no longer discovered at all (previously: discovered, hashed, counted, zero nodes produced).
- [x] `SUPPORTED_EXTENSIONS`'s hardcoded list is gone from `file-discovery.ts` — extensions are derived from `getAvailableParsers()`.
- [x] `nodum config --set-exclude "**/*.generated.ts"` writes `.nodumrc.json`, and a subsequent `nodum sync` excludes matching files.
- [x] `nodum config --set-include "src/**"` scoped to just `src/**` — files outside it are not discovered even without being gitignored.
- [x] `nodum config` with no flags prints the resolved configuration without mutating anything.
- [x] A project with no `.gitignore` and no `.nodumrc.json` behaves exactly as before this spec (default `IGNORED_DIRS` + real supported extensions only).
- [x] Excluding a directory via `.gitignore` or `--set-exclude` stops the walk from recursing into it (not just filtering its files after the fact).

## Test plan

`packages/core/src/scan-config.test.ts` (new):
- `loadScanConfig` returns `{}` for a project with no `.nodumrc.json`; returns the parsed content when present; returns `{}` (not a throw) for malformed JSON.
- `buildFileMatcher`: a path matching a `.gitignore` line is excluded; a path matching `config.exclude` is excluded even without a `.gitignore`; with `config.include` set, only matching paths pass, everything else is excluded regardless of `.gitignore`.

Update `packages/core/src/file-discovery.test.ts`:
- Fixture project with a `.gitignore` excluding `ignored-dir/` and `secret.ts` — neither is discovered.
- Fixture with `.rs`/`.go`/`.rb` files present — none discovered (extension no longer supported).
- Fixture with `.nodumrc.json` setting `include: ["src/**"]` — files outside `src/` are not discovered even though nothing excludes them explicitly.

`packages/cli/src/bin/nodum.test.ts` (new, or extend existing CLI test structure) — `config --set-exclude` writes the expected `.nodumrc.json`; `config` with no flags doesn't touch the filesystem beyond reading.

## Success Metrics

- Real check: create a scratch project with a `.gitignore` excluding a subdirectory full of `.ts` files — `nodum sync` before this spec scans them, after this spec doesn't.
- Real check: a scratch project with a `.rs` file — `nodum sync`'s reported `stats.files` no longer includes it.

## Related

Independent of specs 003/004 (incremental sync) — this changes *what* gets discovered, not *how efficiently*. Both `discoverFiles` and `discoverChangedFiles` get the matcher, so incremental sync respects the same include/exclude rules automatically.
