import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import ignore from 'ignore';

export interface ScanConfig {
  /** Glob/gitignore-syntax patterns — if set, ONLY matching files are scanned. */
  include?: string[];
  /** Glob/gitignore-syntax patterns, applied in addition to .gitignore. */
  exclude?: string[];
}

const CONFIG_FILENAME = '.nodumrc.json';

export async function loadScanConfig(rootPath: string): Promise<ScanConfig> {
  try {
    const content = await readFile(join(rootPath, CONFIG_FILENAME), 'utf-8');
    const parsed = JSON.parse(content);
    return {
      include: Array.isArray(parsed.include) ? parsed.include : undefined,
      exclude: Array.isArray(parsed.exclude) ? parsed.exclude : undefined,
    };
  } catch {
    return {};
  }
}

export async function saveScanConfig(rootPath: string, update: ScanConfig): Promise<void> {
  const existing = await loadScanConfig(rootPath);
  const merged: ScanConfig = {
    include: update.include ?? existing.include,
    exclude: update.exclude ?? existing.exclude,
  };
  await writeFile(join(rootPath, CONFIG_FILENAME), JSON.stringify(merged, null, 2), 'utf-8');
}

export interface FileMatcher {
  /**
   * True if this path — file or directory (directory paths must end with
   * '/', per the `ignore` package's own trailing-slash-for-directories
   * semantics) — is excluded by `.gitignore`/`config.exclude`. Safe to use
   * for pruning directory recursion: if a directory is excluded, nothing
   * inside it can possibly matter.
   */
  isExcluded(relativePath: string): boolean;
  /**
   * True if this *file* path is allowed by `config.include` (or there's no
   * include list, in which case everything passes). Deliberately NOT safe
   * for pruning directory recursion — a directory like `src/` does not
   * itself match a glob like `src/**`, only files inside it do.
   */
  isIncluded(relativePath: string): boolean;
}

/**
 * Builds the exclude/include rule sets for a project: `.gitignore` (project
 * root only, not nested) plus `config.exclude` for exclusion, and
 * `config.include` — if given — as an allowlist for files.
 */
export async function buildFileMatcher(rootPath: string, config: ScanConfig): Promise<FileMatcher> {
  const excludeRules = ignore();
  try {
    const gitignoreContent = await readFile(join(rootPath, '.gitignore'), 'utf-8');
    excludeRules.add(gitignoreContent);
  } catch {
    // No .gitignore — that's fine.
  }
  if (config.exclude?.length) {
    excludeRules.add(config.exclude);
  }

  const includeRules = config.include?.length ? ignore().add(config.include) : null;

  return {
    isExcluded: (relativePath: string): boolean => excludeRules.ignores(relativePath),
    isIncluded: (relativePath: string): boolean => (includeRules ? includeRules.ignores(relativePath) : true),
  };
}
