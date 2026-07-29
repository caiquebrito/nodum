import { resolve, sep } from 'path';

/**
 * Resolves a route-supplied `projectName` to its on-disk `graph.json` path,
 * or `null` if the name could escape `dataDir`. A real path-traversal bug
 * existed before this module: `projectName` was interpolated straight into
 * a file path with no validation, and Express URL-decodes route params
 * *after* routing — so a request for `/api/projects/..%2Fsome-dir/graph`
 * reaches the handler with `projectName === "../some-dir"`, escaping
 * `dataDir` (confirmed empirically against the unpatched server before
 * writing this fix, per spec 047).
 *
 * Deliberately a resolved-path containment check, not a character
 * allowlist. Project names come from real directory `basename()`s
 * (`packages/cli/src/commands/sync.ts` et al.) and can legitimately
 * contain spaces, `+`, or non-ASCII characters — an allowlist regex would
 * be a real behavior regression for those users. Containment is strictly
 * stronger and doesn't reject anything legal.
 *
 * Known, accepted limitation: this is a lexical check, not a `realpath()`
 * check, so a symlink inside `dataDir` pointing outside it would still
 * resolve. `~/.nodum` is created and exclusively written by nodum itself
 * (never user-supplied symlinks), so this is treated as an accepted
 * limitation rather than adding an async `fs` call to every request.
 */
export function resolveProjectGraphPath(dataDir: string, projectName: string): string | null {
  if (!projectName || projectName === '.' || projectName === '..') return null;
  if (/[/\\\0]/.test(projectName)) return null;

  const root = resolve(dataDir);
  const target = resolve(root, projectName, 'graph', 'graph.json');

  if (!target.startsWith(root + sep)) return null;
  return target;
}
