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
    // chokidar calls this twice per path — once with just the path (no
    // stats), once with stats — and the no-stats call is what actually
    // gates traversal, so we can't rely on stats.isDirectory() to know
    // whether to test the trailing-slash (directory) form of a gitignore
    // pattern. Test both forms instead: a genuine file won't spuriously
    // match a directory-only pattern's trailing-slash form in practice,
    // and this works correctly regardless of which call chokidar is on.
    ignored: (path: string) => {
      const rel = relative(absolutePath, path);
      if (rel === '') return false; // the watched root itself
      // Every triggered sync rewrites CLAUDE.md (via injectCLAUDEContext) at
      // the project root with a fresh timestamp — without this, watching it
      // would retrigger a sync on every sync, forever.
      if (rel === 'CLAUDE.md') return true;
      const topSegment = rel.split(/[\\/]/)[0];
      if (IGNORED_DIRS.has(topSegment)) return true;
      return matcher.isExcluded(rel) || matcher.isExcluded(`${rel}/`);
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
      console.log(
        `✅ [${time}] Synced: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes`,
      );
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
  // starts, not just after the first detected change. incremental: true
  // already falls back to a full sync when there's no prior graph.
  await runSync();

  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watch...');
    void watcher.close().then(() => process.exit(0));
  });
}
