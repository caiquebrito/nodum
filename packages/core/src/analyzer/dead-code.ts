import ignore from 'ignore';
import { dirname } from 'path';
import type { Graph, Node } from '../types.js';

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
 * True when some other file in the same directory (this codebase's
 * existing pragmatic proxy for "same package," see `resolveJvmImport`'s own
 * directory-suffix matching) textually references one of `candidate`'s own
 * declared top-level symbol names — Kotlin's same-package, no-`import`
 * visibility rule (see `Node.referencedIdentifiers`'s doc comment) means
 * that reference produces no `imports` edge at all, so `detectUnreachableFiles`
 * would otherwise flag a genuinely-used file as dead.
 */
function usedBySamePackageSibling(candidate: Node, allNodes: Node[]): boolean {
  const nodeSymbols = allNodes
    .filter(n => n.type !== 'file' && n.file === candidate.file)
    .map(n => n.label);
  // `declaredTopLevelNames` (see its doc comment) additionally covers
  // top-level properties, which never get their own `Node` — a plain
  // `nodeSymbols` scan alone would miss e.g. a Koin `val commonModule = ...`.
  const declaredSymbols = [...new Set([...nodeSymbols, ...(candidate.declaredTopLevelNames ?? [])])];
  if (declaredSymbols.length === 0) return false;

  const dir = dirname(candidate.file);
  return allNodes.some(
    n =>
      n.type === 'file' &&
      n.file !== candidate.file &&
      dirname(n.file) === dir &&
      n.referencedIdentifiers?.some(id => declaredSymbols.includes(id)),
  );
}

/**
 * Files no other tracked file imports — candidates for dead code, not a
 * definitive verdict (see spec 012's Scope: a real entry point wired up
 * outside the parsed import graph looks identical to an orphaned file from
 * here). Test files, files matching an entry-point-name heuristic, and
 * files a same-package sibling references without an `import` (see
 * `usedBySamePackageSibling`) are excluded from the result.
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
    .filter(n => !usedBySamePackageSibling(n, graph.nodes))
    .map(n => ({ nodeId: n.id, file: n.file }));
}
