import { readdir, readFile } from 'fs/promises';
import { join, relative, normalize, sep } from 'path';
import type { Node } from '../types.js';

const CI_FILE_EXTENSIONS = new Set(['.yml', '.yaml', '.sh']);
const IGNORED_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', '.idea']);

// Extensions a CI-invoked script realistically has — kept in sync with each
// parser's own `extensions` field (see `parser/*.ts`), plus `.sh` itself
// since CI YAML commonly calls a wrapper shell script that in turn invokes
// the real one.
const SCRIPT_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'kt', 'kts', 'java', 'go', 'swift', 'm', 'h', 'sh',
];

// A whitespace/quote-delimited token containing at least one `/` and ending
// in a known script extension — e.g. `tools/ci/run_quality_checks.py` inside
// `python3 tools/ci/run_quality_checks.py --base "..."`. Deliberately not a
// shell parser: no handling of variable expansion (`$SCRIPT_DIR/foo.py`) or
// quoting rules beyond the delimiter itself — a missed match just leaves the
// file to today's behavior (still a dead-code candidate), which is the safe
// direction to fail in.
const PATH_TOKEN = /[.\w-]+(?:\/[.\w-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|kt|kts|java|go|swift|m|h|sh)\b/g;

/**
 * Recursively finds every `.yml`/`.yaml`/`.sh` file under `rootPath` —
 * CI pipeline definitions and the shell scripts they call out to.
 */
async function findCiFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      found.push(...(await findCiFiles(join(dir, entry.name))));
    } else if ([...CI_FILE_EXTENSIONS].some(ext => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }

  return found;
}

/**
 * Extracts every path-shaped token from a CI YAML/shell file's contents —
 * see `PATH_TOKEN`'s doc comment for what counts as one.
 */
export function parseCiInvokedPaths(contents: string): string[] {
  const matches = contents.match(PATH_TOKEN) ?? [];
  return [...new Set(matches)];
}

/**
 * Finds every `.yml`/`.yaml`/`.sh` file under `rootPath`, extracts the
 * script paths it references, and resolves each against the graph's known
 * file paths — a script only ever invoked as a CI subprocess (e.g.
 * `python3 tools/ci/run_quality_checks.py`) has no `imports` edge pointing
 * at it and would otherwise read as dead code (see spec 062). Returns the
 * matching file paths, suitable to pass straight into
 * `detectUnreachableFiles`'s `entryPatterns`.
 */
export async function findCiInvokedFiles(rootPath: string, graphNodes: Node[]): Promise<string[]> {
  const knownFilePaths = new Set(
    graphNodes.filter(n => n.type === 'file' && n.file.length > 0 && SCRIPT_EXTENSIONS.some(ext => n.file.endsWith(`.${ext}`))).map(n => n.file),
  );
  if (knownFilePaths.size === 0) return [];

  const ciFiles = await findCiFiles(rootPath);
  if (ciFiles.length === 0) return [];

  const entryFiles = new Set<string>();
  for (const ciFile of ciFiles) {
    let contents: string;
    try {
      contents = await readFile(ciFile, 'utf-8');
    } catch {
      continue;
    }

    const ciFileDir = relative(rootPath, join(ciFile, '..'));
    for (const token of parseCiInvokedPaths(contents)) {
      const candidates = new Set([
        token,
        normalize(join(ciFileDir, token)).split(sep).join('/'),
      ]);
      for (const candidate of candidates) {
        const normalized = candidate.replace(/^\.\//, '');
        if (knownFilePaths.has(normalized)) {
          entryFiles.add(normalized);
          continue;
        }
        const suffixMatch = [...knownFilePaths].find(
          known => known === normalized || known.endsWith(`/${normalized}`) || normalized.endsWith(`/${known}`),
        );
        if (suffixMatch) entryFiles.add(suffixMatch);
      }
    }
  }

  return [...entryFiles];
}
