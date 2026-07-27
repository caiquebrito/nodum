# 006 — `nodum watch`: auto-sync on file change

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (cli 15/15 incl. 10 new watch.test.ts cases), and real end-to-end nodum watch: initial sync on startup, watched-file edit triggers exactly one sync, gitignored-file edit triggers zero syncs, SIGINT exits cleanly. Two real bugs (chokidar stats unreliability, CLAUDE.md self-triggering loop) found only via real testing and fixed — see "Bugs found" section below

## Goal

`nodum watch [projectPath]` — a long-running command that watches a project for file changes and automatically triggers an incremental sync, so the knowledge graph stays current without the user remembering to run `nodum sync` after every edit.

## Why now

Spec 004 built `--incremental`; this is its most natural consumer — watch mode is useless if every trigger does a full rescan. Spec 005's scan-config matcher is reused here too, so watch mode respects the exact same `.gitignore`/`.nodumrc.json` rules as sync — no separate ignore list to keep in sync.

## Scope

- `packages/cli/src/commands/watch.ts` (new) — the watch loop.
- `packages/cli/src/bin/nodum.ts` — new `nodum watch [projectPath]` command, with a `--debounce <ms>` option (default 500).
- `packages/cli/package.json` — new `chokidar` dependency.
- `packages/core/src/file-discovery.ts` / `index.ts` — export `IGNORED_DIRS` (currently private) so watch mode's chokidar instance can skip the same coarse directories (`node_modules`, `.git`, etc.) without watching thousands of irrelevant files, ahead of ever calling into `buildFileMatcher`.

## Out of scope

- Watching multiple projects from one `nodum watch` invocation — one project per process, matching every other CLI command's shape.
- A `--once` / dry-run mode that reports what *would* sync without doing it.
- Debounce-window auto-tuning based on project size — fixed default (overridable via flag), not adaptive.
- Restarting the watcher automatically if `.nodumrc.json`/`.gitignore` changes mid-session (a rule change takes effect on the *next* natural trigger sync, not instantly) — acceptable staleness for a first version.

## Design

**`packages/core`** — export the existing private `IGNORED_DIRS` set (used by chokidar to avoid ever watching `node_modules`, `.git`, etc. — a coarse, cheap pre-filter *before* the real matcher, same division of labor as the directory-pruning logic in spec 005).

**`packages/cli/src/commands/watch.ts`**:

```ts
import { resolve, relative } from 'path';
import chokidar from 'chokidar';
import {
  syncProject as coreSyncProject,
  loadScanConfig,
  buildFileMatcher,
  IGNORED_DIRS,
} from '@caiquebrito/nodum-core';

export interface WatchOptions {
  debounceMs?: number;
}

export async function watchProject(
  projectPath: string,
  nodumDataDir: string,
  options: WatchOptions = {},
): Promise<void> {
  const absolutePath = resolve(projectPath);
  const debounceMs = options.debounceMs ?? 500;

  const config = await loadScanConfig(absolutePath);
  const matcher = await buildFileMatcher(absolutePath, config);

  const watcher = chokidar.watch(absolutePath, {
    ignoreInitial: true,
    ignored: (path: string, stats?: { isDirectory(): boolean }) => {
      const rel = relative(absolutePath, path);
      if (rel === '') return false; // the root itself
      const topSegment = rel.split(/[\\/]/)[0];
      if (IGNORED_DIRS.has(topSegment)) return true;
      const testPath = stats?.isDirectory() ? `${rel}/` : rel;
      return matcher.isExcluded(testPath);
    },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSync = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSync(), debounceMs);
  };

  const runSync = async (): Promise<void> => {
    try {
      const graph = await coreSyncProject(absolutePath, nodumDataDir, { incremental: true });
      const time = new Date().toLocaleTimeString();
      console.log(`✅ [${time}] Synced: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes`);
    } catch (error) {
      console.error('❌ Sync failed:', error instanceof Error ? error.message : String(error));
    }
  };

  watcher
    .on('add', scheduleSync)
    .on('change', scheduleSync)
    .on('unlink', scheduleSync)
    .on('error', (error) => console.error('⚠️  Watcher error:', error));

  console.log(`👀 Watching: ${absolutePath}`);
  console.log(`   Debounce: ${debounceMs}ms — Press Ctrl+C to stop\n`);

  // Baseline sync so the graph reflects the current state the moment watch
  // starts, not just after the first detected change. `incremental: true`
  // already falls back to a full sync when there's no prior graph (spec 004).
  await runSync();

  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watch...');
    void watcher.close().then(() => process.exit(0));
  });
}
```

**Why `chokidar` (not a hand-rolled `fs.watch` loop):** `fs.watch` is notoriously inconsistent across platforms (macOS/Linux/Windows all report different event granularity, and recursive watching support varies). `chokidar` is the de facto standard for exactly this — used by most Node dev-server tooling — and normalizes all of that. Pinning to `^3.6.0`: mature, stable, glob-string `ignored` + function `ignored` both supported, well-understood TypeScript types, works fine as a CJS dependency under this repo's `esModuleInterop: true`.

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('watch [projectPath]')
  .description('Watch a project and automatically sync on file changes (incremental)')
  .option('--debounce <ms>', 'Milliseconds to wait after a change before syncing', '500')
  .action(async (projectPath: string | undefined, options: { debounce: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { watchProject } = await import('../commands/watch.js');
      await watchProject(projectPath || process.cwd(), nodumDataDir, {
        debounceMs: parseInt(options.debounce, 10),
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
```

## Bugs found during real end-to-end testing (not caught by unit tests)

Two real bugs surfaced only once this was actually run against a filesystem — both fixed before merge:

1. **chokidar's `ignored` function is called twice per path — once with no `stats` argument at all.** The original design relied on `stats?.isDirectory()` to decide whether to test the trailing-slash (directory) form of a gitignore pattern. Since the no-stats call is what actually gates traversal, a directory-only exclude rule (e.g. `vendor-stuff/`) never matched, and everything inside a gitignored directory was watched anyway. Fixed by testing both the plain and trailing-slash form of every path unconditionally, instead of depending on chokidar's inconsistent stats delivery.
2. **Infinite self-triggering sync loop.** Every sync rewrites `CLAUDE.md` at the project root (via `injectCLAUDEContext`) with a fresh timestamp. Watching that file meant every completed sync immediately triggered another — observed as a sync firing every ~400ms with zero actual edits. Fixed by explicitly excluding the project-root `CLAUDE.md` from ever scheduling a sync.

Both are now covered by dedicated regression tests in `watch.test.ts`, and the fix was re-verified against the real filesystem, not just the unit tests.

## Acceptance criteria

- [x] `nodum watch` performs an initial sync immediately on startup (not waiting for the first file change).
- [x] A file change triggers a sync with `incremental: true`.
- [x] Rapid successive changes (e.g. 5 files saved within 100ms) trigger exactly one sync, not five — debounce coalesces them.
- [x] Changes inside `node_modules`/`.git`/other `IGNORED_DIRS` entries never trigger a sync (chokidar never even watches them).
- [x] A change inside a `.gitignore`d or `.nodumrc.json`-excluded path does not trigger a sync.
- [x] Ctrl+C (`SIGINT`) cleanly stops the watcher and exits the process.
- [x] A sync failure (e.g. a transient parse error) logs and keeps watching — does not crash the process.
- [x] `--debounce <ms>` actually changes the wait window.

## Test plan

`packages/cli/src/commands/watch.test.ts` (new) — mock `chokidar` (an `EventEmitter`-like fake with a `.close()` spy) and `@caiquebrito/nodum-core`'s `syncProject`/`loadScanConfig`/`buildFileMatcher`:
- Emitting `'change'` triggers `syncProject` with `{ incremental: true }` after the debounce window (use `vi.useFakeTimers()`).
- Emitting `'change'` 5 times within the debounce window triggers `syncProject` exactly once.
- The `ignored` function passed to chokidar returns `true` for a path under a coarse `IGNORED_DIRS` entry without ever calling `matcher.isExcluded`.
- The `ignored` function delegates to `matcher.isExcluded` (with the directory trailing-slash convention) for paths not caught by the coarse check.
- A `syncProject` rejection is caught and logged, and the watcher is not closed as a result.
- `SIGINT` calls `watcher.close()`.

## Success Metrics

- Real check: `nodum watch` a scratch project in the background, edit one file, confirm (after the debounce window) `graph.json`'s `lastSync`/content reflects the edit — without a manual `nodum sync`.
- Real check: edit a file inside a `.gitignore`d directory while watching — confirm no sync is triggered (`graph.json`'s mtime unchanged).

## Related

Depends on: `004-incremental-graph-generation` (what every triggered sync uses), `005-cli-config-command` (the matcher watch mode reuses for ignore rules).
