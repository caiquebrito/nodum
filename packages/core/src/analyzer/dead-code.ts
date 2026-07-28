import ignore from 'ignore';
import type { Graph } from '../types.js';

export interface UnreachableFile {
  nodeId: string;
  /** File path, e.g. "src/lib/legacy-helper.ts". */
  file: string;
}

const DEFAULT_ENTRY_PATTERNS = [
  '**/index.*',
  '**/main.*',
  '**/app.*',
  '**/server.*',
  '**/cli.*',
  '**/bin.*',
  '**/bin/**',
  '**/*.config.*',
];

export interface DetectUnreachableFilesOptions {
  /** Additional gitignore-syntax globs, merged with the built-in entry-point defaults. */
  entryPatterns?: string[];
}

/**
 * Files no other tracked file imports — candidates for dead code, not a
 * definitive verdict (see spec 012's Scope: a real entry point wired up
 * outside the parsed import graph looks identical to an orphaned file from
 * here). Test files and files matching an entry-point-name heuristic are
 * excluded from the result, since "nothing imports this" is expected and
 * correct for both.
 */
export function detectUnreachableFiles(
  graph: Graph,
  options: DetectUnreachableFilesOptions = {},
): UnreachableFile[] {
  const importedTargets = new Set(
    graph.edges.filter(e => e.relation === 'imports').map(e => e.target),
  );

  const entryMatcher = ignore().add([...DEFAULT_ENTRY_PATTERNS, ...(options.entryPatterns ?? [])]);

  return graph.nodes
    .filter(n => n.type === 'file')
    .filter(n => !importedTargets.has(n.id))
    .filter(n => n.group !== 'test')
    .filter(n => !entryMatcher.ignores(n.file))
    .map(n => ({ nodeId: n.id, file: n.file }));
}
