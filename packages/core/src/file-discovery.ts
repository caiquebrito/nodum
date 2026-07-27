import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import type { FileInfo, FileManifest } from './types.js';
import { getAvailableParsers } from './parser/index.js';
import { loadScanConfig, buildFileMatcher, type FileMatcher } from './scan-config.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.next',
  '__pycache__',
  'coverage',
  '.gradle',
  '.idea',
  '.DS_Store',
  'target',
  '.env',
  '.venv',
  'venv',
  'vendor',
  '.cargo',
  'output',
  'tmp',
]);

function supportedExtensions(): Set<string> {
  return new Set(getAvailableParsers().flatMap(p => p.extensions.map(e => e.toLowerCase())));
}

type FileVisitor = (fullPath: string, relativePath: string, ext: string) => Promise<void>;

async function walkFiles(
  currentPath: string,
  rootPath: string,
  matcher: FileMatcher,
  extensions: Set<string>,
  visit: FileVisitor,
): Promise<void> {
  try {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and ignored directories
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        continue;
      }

      if (IGNORED_DIRS.has(entry.name)) {
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
        await walkFiles(fullPath, rootPath, matcher, extensions, visit);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.has(ext.toLowerCase()) && !matcher.isExcluded(relativePath) && matcher.isIncluded(relativePath)) {
          try {
            await visit(fullPath, relativePath, ext);
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

export async function discoverFiles(rootPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const config = await loadScanConfig(rootPath);
  const matcher = await buildFileMatcher(rootPath, config);
  const extensions = supportedExtensions();

  await walkFiles(rootPath, rootPath, matcher, extensions, async (fullPath, relativePath, ext) => {
    const content = await readFile(fullPath, 'utf-8');
    const stats = await stat(fullPath);
    const hash = createHash('sha256').update(content).digest('hex');
    files.push({
      path: relativePath,
      ext,
      content,
      hash,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  });

  return files;
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
): Promise<DiscoveryDiff> {
  const changed: FileInfo[] = [];
  const unchanged: FileManifest = {};
  const seenPaths = new Set<string>();
  const config = await loadScanConfig(rootPath);
  const matcher = await buildFileMatcher(rootPath, config);
  const extensions = supportedExtensions();

  await walkFiles(rootPath, rootPath, matcher, extensions, async (fullPath, relativePath, ext) => {
    seenPaths.add(relativePath);
    const stats = await stat(fullPath);
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
  });

  // Anything previously known but not seen this walk is treated as deleted —
  // whether it was actually removed from disk, or newly excluded via
  // .gitignore/.nodumrc.json. Both cases should evict its nodes/edges from
  // the graph the same way.
  const deletedPaths = Object.keys(previousManifest).filter(p => !seenPaths.has(p));

  return { changed, unchanged, deletedPaths };
}
