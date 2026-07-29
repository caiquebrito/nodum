import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import type { FileInfo, FileManifest } from './types.js';
import { getAvailableParsers } from './parser/index.js';
import { loadScanConfig, buildFileMatcher, type FileMatcher } from './scan-config.js';

// Cross-cutting only — entries no single language ecosystem owns. Anything
// language-specific (`__pycache__`, `.gradle`, `venv`, ...) is contributed
// by the owning Parser's `ignoredDirs` instead (spec 030) — the same
// registry-driven pattern `supportedExtensions()` below already used.
const CROSS_CUTTING_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.next',
  'coverage',
  '.idea',
  '.DS_Store',
  '.env',
  'vendor',
  '.cargo',
  'output',
  'tmp',
]);

/**
 * Cross-cutting dirs merged with every registered parser's own
 * `ignoredDirs`, computed once at module load — parsers are constructed
 * eagerly and synchronously (see spec 030), so this needs no async
 * handling despite some of those parsers being tree-sitter-backed.
 *
 * Kept as a plain exported `Set`, not a function, since `packages/cli`'s
 * `watch` command already consumes it directly as a synchronous constant.
 */
export const IGNORED_DIRS = new Set([
  ...CROSS_CUTTING_IGNORED_DIRS,
  ...getAvailableParsers().flatMap(p => p.ignoredDirs ?? []),
]);

/**
 * `IGNORED_DIRS` plus a project's own `.nodumrc.json` `ignoredDirs`
 * additions — used by `discoverFiles`/`discoverChangedFiles`, which (unlike
 * `IGNORED_DIRS` itself) have per-project config in scope.
 */
function buildIgnoredDirs(configIgnoredDirs?: string[]): Set<string> {
  if (!configIgnoredDirs?.length) return IGNORED_DIRS;
  return new Set([...IGNORED_DIRS, ...configIgnoredDirs]);
}

function supportedExtensions(): Set<string> {
  return new Set(getAvailableParsers().flatMap(p => p.extensions.map(e => e.toLowerCase())));
}

/** Skip (with a warning) rather than read+parse a file bigger than this, by default (spec 042). */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
/** Warn (never truncate) once the discovered file count exceeds this, by default (spec 042). */
export const DEFAULT_MAX_FILES_WARNING = 20_000;

export interface DiscoveryOptions {
  /**
   * Surfaces guardrail warnings (oversized files skipped, file count over
   * the configured threshold) back to the caller — same callback-threading
   * pattern as `SyncHooks`'s `onParseProgress`/`onStep` (spec 042).
   */
  onWarning?: (message: string) => void;
}

/** Entries matched during directory traversal, not yet read. */
interface FileEntry {
  fullPath: string;
  relativePath: string;
  ext: string;
}

/**
 * Bounded-concurrency map: runs `fn` over `items` with at most `concurrency`
 * calls in flight at once. Hand-rolled rather than a new dependency — file
 * discovery's per-file work (`readFile`+`stat`+hash) is I/O-bound and
 * genuinely benefits from overlap, unlike tree-sitter parsing (CPU-bound,
 * out of scope for this same reason — see spec 042's Design).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Sequential recursive directory walk that only collects the matching file
 * entries — no file I/O beyond `readdir` itself, so there's no shared
 * mutable state to worry about parallelizing this half. Per-file
 * read/stat/hash work happens afterward, with bounded concurrency, in
 * `discoverFiles`/`discoverChangedFiles`.
 */
async function collectFileEntries(
  currentPath: string,
  rootPath: string,
  matcher: FileMatcher,
  extensions: Set<string>,
  ignoredDirs: Set<string>,
  out: FileEntry[],
): Promise<void> {
  try {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and ignored directories
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        continue;
      }

      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);
      const relativePath = fullPath.substring(rootPath.length + 1);

      if (entry.isDirectory()) {
        // Skip recursing into excluded directories entirely — but only on
        // exclude rules, never include rules: a directory like `src/`
        // legitimately doesn't match a glob like `src/**` even though files
        // inside it do, so include-filtering only applies at the file level.
        // Gitignore directory-only patterns (e.g. `dist/`) only match a
        // trailing-slash path, per the `ignore` package's own semantics.
        if (matcher.isExcluded(`${relativePath}/`)) {
          continue;
        }
        await collectFileEntries(fullPath, rootPath, matcher, extensions, ignoredDirs, out);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.has(ext.toLowerCase()) && !matcher.isExcluded(relativePath) && matcher.isIncluded(relativePath)) {
          out.push({ fullPath, relativePath, ext });
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

function warnIfOverFileCountThreshold(
  entryCount: number,
  maxFilesWarning: number,
  onWarning: ((message: string) => void) | undefined,
): void {
  if (entryCount > maxFilesWarning) {
    onWarning?.(
      `Discovered ${entryCount} files, over the ${maxFilesWarning}-file guardrail — sync may be slow. ` +
        `Consider narrowing scope via .nodumrc.json's "exclude"/"include", or raising "maxFilesWarning".`,
    );
  }
}

const DISCOVERY_CONCURRENCY = 8;

export async function discoverFiles(rootPath: string, options: DiscoveryOptions = {}): Promise<FileInfo[]> {
  const config = await loadScanConfig(rootPath);
  const matcher = await buildFileMatcher(rootPath, config);
  const extensions = supportedExtensions();
  const ignoredDirs = buildIgnoredDirs(config.ignoredDirs);
  const maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxFilesWarning = config.maxFilesWarning ?? DEFAULT_MAX_FILES_WARNING;

  const entries: FileEntry[] = [];
  await collectFileEntries(rootPath, rootPath, matcher, extensions, ignoredDirs, entries);
  warnIfOverFileCountThreshold(entries.length, maxFilesWarning, options.onWarning);

  const results = await mapWithConcurrency(entries, DISCOVERY_CONCURRENCY, async ({ fullPath, relativePath, ext }) => {
    try {
      const stats = await stat(fullPath);
      if (stats.size > maxFileSizeBytes) {
        options.onWarning?.(
          `Skipped ${relativePath} (${stats.size} bytes, over the ${maxFileSizeBytes}-byte guardrail)`,
        );
        return null;
      }

      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      return { path: relativePath, ext, content, hash, mtimeMs: stats.mtimeMs, size: stats.size } satisfies FileInfo;
    } catch {
      // Skip files that can't be read
      return null;
    }
  });

  return results.filter((f): f is FileInfo => f !== null);
}

export interface DiscoveryDiff {
  /** New or modified files — full content read, ready to parse. */
  changed: FileInfo[];
  /** Confirmed-unchanged entries, ready to merge into the new manifest as-is. */
  unchanged: FileManifest;
  /** Present in the previous manifest, not found during this walk. */
  deletedPaths: string[];
}

/**
 * Like discoverFiles, but given the previous sync's file manifest, skips
 * reading a file's content entirely when its mtime/size still match —
 * only reading (and hashing) files that look like they may have changed.
 */
export async function discoverChangedFiles(
  rootPath: string,
  previousManifest: FileManifest,
  options: DiscoveryOptions = {},
): Promise<DiscoveryDiff> {
  const changed: FileInfo[] = [];
  const unchanged: FileManifest = {};
  const seenPaths = new Set<string>();
  const config = await loadScanConfig(rootPath);
  const matcher = await buildFileMatcher(rootPath, config);
  const extensions = supportedExtensions();
  const ignoredDirs = buildIgnoredDirs(config.ignoredDirs);
  const maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxFilesWarning = config.maxFilesWarning ?? DEFAULT_MAX_FILES_WARNING;

  const entries: FileEntry[] = [];
  await collectFileEntries(rootPath, rootPath, matcher, extensions, ignoredDirs, entries);
  warnIfOverFileCountThreshold(entries.length, maxFilesWarning, options.onWarning);

  await mapWithConcurrency(entries, DISCOVERY_CONCURRENCY, async ({ fullPath, relativePath, ext }) => {
    try {
      seenPaths.add(relativePath);
      const stats = await stat(fullPath);

      if (stats.size > maxFileSizeBytes) {
        options.onWarning?.(
          `Skipped ${relativePath} (${stats.size} bytes, over the ${maxFileSizeBytes}-byte guardrail)`,
        );
        return;
      }

      const prev = previousManifest[relativePath];

      // Fast path: mtime + size match the last sync — trust it, skip the read.
      if (prev && prev.mtimeMs === stats.mtimeMs && prev.size === stats.size) {
        unchanged[relativePath] = prev;
        return;
      }

      // Slow path: something differs on disk — read + hash to see if the
      // content actually changed, or it was just touched (e.g. re-saved
      // with no edits).
      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      if (prev && prev.hash === hash) {
        // Same content, different mtime — not re-parsed, but refresh the
        // manifest entry so the next sync gets the fast path again.
        unchanged[relativePath] = { hash, mtimeMs: stats.mtimeMs, size: stats.size };
        return;
      }

      changed.push({ path: relativePath, ext, content, hash, mtimeMs: stats.mtimeMs, size: stats.size });
    } catch {
      // Skip files that can't be read
    }
  });

  // Anything previously known but not seen this walk is treated as deleted —
  // whether it was actually removed from disk, or newly excluded via
  // .gitignore/.nodumrc.json. Both cases should evict its nodes/edges from
  // the graph the same way.
  const deletedPaths = Object.keys(previousManifest).filter(p => !seenPaths.has(p));

  return { changed, unchanged, deletedPaths };
}
