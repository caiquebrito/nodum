import { basename } from 'path';
import { discoverFiles, discoverChangedFiles } from './file-discovery.js';
import { selectParser } from './parser/index.js';
import type { Graph, Node, Edge, FileInfo, FileManifest } from './types.js';

export interface GenerateGraphOptions {
  onProgress?: (processed: number, total: number) => void;
  /** Previous graph to diff against — supplying both this and `previousFiles` enables incremental generation. */
  previousGraph?: Graph;
  /** Previous file manifest to diff against. */
  previousFiles?: FileManifest;
}

export async function generateGraph(
  projectPath: string,
  options: GenerateGraphOptions = {},
): Promise<{ graph: Graph; files: FileManifest }> {
  const { onProgress, previousGraph, previousFiles } = options;

  if (previousGraph && previousFiles) {
    return generateGraphIncremental(projectPath, previousGraph, previousFiles, onProgress);
  }

  return generateGraphFull(projectPath, onProgress);
}

async function generateGraphFull(
  projectPath: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ graph: Graph; files: FileManifest }> {
  const files = await discoverFiles(projectPath);

  const nodeMap = new Map<string, Node>();
  const edgesSet = new Set<string>();
  const rawImports: RawFileImports[] = [];
  await parseFilesInto(files, nodeMap, edgesSet, rawImports, onProgress);
  resolveImportsInto(rawImports, nodeMap, edgesSet);

  const edges = edgesFromSet(edgesSet);
  const nodes = Array.from(nodeMap.values());

  const graph: Graph = {
    project: basename(projectPath),
    stats: buildStats(files.length, nodes, edges),
    nodes,
    edges,
  };

  const fileManifest: FileManifest = {};
  for (const file of files) {
    fileManifest[file.path] = { hash: file.hash, mtimeMs: file.mtimeMs, size: file.size };
  }

  return { graph, files: fileManifest };
}

/**
 * Only re-parses files that changed since `previousFiles` was recorded.
 * Nodes/edges belonging to unchanged files are carried over verbatim from
 * `previousGraph`; nodes/edges belonging to changed or deleted files are
 * evicted and, for changed files, replaced with a fresh parse.
 *
 * Cross-file `imports` edges (spec 010) need more care than intra-file
 * edges: an edge A→B must survive when only B changes, since file-node IDs
 * are stable across re-parses (derived from path, not content) — A's import
 * statement didn't change, so the edge shouldn't be dropped just because B
 * was temporarily evicted pending re-parse. Eviction is therefore split
 * into phases, keyed off each edge's SOURCE file rather than requiring both
 * endpoints to have survived the initial cut:
 *
 *   1. Keep nodes belonging to genuinely untouched files only.
 *   2. Re-parse changed files — fresh nodes, their own edges, raw imports.
 *   3. Carry over any previous edge whose source file is untouched, as long
 *      as its target still exists in the now-current node set.
 *   4. Resolve imports for changed files against that current node set.
 */
async function generateGraphIncremental(
  projectPath: string,
  previousGraph: Graph,
  previousFiles: FileManifest,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ graph: Graph; files: FileManifest }> {
  const diff = await discoverChangedFiles(projectPath, previousFiles);
  const touchedPaths = new Set<string>([...diff.deletedPaths, ...diff.changed.map(f => f.path)]);

  // Phase 1: keep only nodes belonging to untouched files.
  const previousNodesById = new Map(previousGraph.nodes.map(n => [n.id, n]));
  const nodeMap = new Map<string, Node>(
    previousGraph.nodes.filter(n => !touchedPaths.has(n.file)).map(n => [n.id, n]),
  );

  // Phase 2: re-parse changed files — fresh nodes, their own edges, and
  // their raw (unresolved) import specifiers.
  const edgesSet = new Set<string>();
  const rawImports: RawFileImports[] = [];
  await parseFilesInto(diff.changed, nodeMap, edgesSet, rawImports, onProgress);

  // Phase 3: carry over edges whose source belonged to an untouched file, as
  // long as their target still exists in the current (post-reparse) node
  // set. This is what lets an A→B import edge survive when only B changed.
  for (const edge of previousGraph.edges) {
    const sourceFile = previousNodesById.get(edge.source)?.file;
    if (sourceFile === undefined || touchedPaths.has(sourceFile)) continue;
    if (!nodeMap.has(edge.target)) continue;
    edgesSet.add(edgeKey(edge));
  }

  // Phase 4: resolve imports for changed files against the final node set
  // (untouched survivors + freshly re-added), so a changed file's imports
  // can correctly target both pre-existing and newly-added files.
  resolveImportsInto(rawImports, nodeMap, edgesSet);

  const edges = edgesFromSet(edgesSet);
  const nodes = Array.from(nodeMap.values());
  const totalFiles = Object.keys(diff.unchanged).length + diff.changed.length;

  const graph: Graph = {
    project: basename(projectPath),
    stats: buildStats(totalFiles, nodes, edges),
    nodes,
    edges,
  };

  const fileManifest: FileManifest = { ...diff.unchanged };
  for (const file of diff.changed) {
    fileManifest[file.path] = { hash: file.hash, mtimeMs: file.mtimeMs, size: file.size };
  }

  return { graph, files: fileManifest };
}

interface RawFileImports {
  filePath: string;
  ext: string;
  imports: string[];
}

async function parseFilesInto(
  files: FileInfo[],
  nodeMap: Map<string, Node>,
  edgesSet: Set<string>,
  rawImports: RawFileImports[],
  onProgress?: (processed: number, total: number) => void,
): Promise<void> {
  const total = files.length;
  let processed = 0;
  onProgress?.(0, total);

  for (const file of files) {
    const parser = selectParser(file.ext);
    if (!parser) {
      processed++;
      onProgress?.(processed, total);
      continue;
    }

    try {
      const { nodes, edges: fileEdges, imports } = await parser.parse(file);

      for (const node of nodes) {
        if (!nodeMap.has(node.id)) {
          nodeMap.set(node.id, node);
        }
      }

      for (const edge of fileEdges) {
        edgesSet.add(edgeKey(edge));
      }

      if (imports?.length) {
        rawImports.push({ filePath: file.path, ext: file.ext, imports });
      }
    } catch {
      // Skip files with parse errors
    }

    processed++;
    onProgress?.(processed, total);
  }
}

/**
 * Resolves every collected file's raw import specifiers against the given
 * node map (which must already contain every file the imports could
 * possibly target) and adds the resulting `imports` edges into edgesSet.
 *
 * Dispatch is delegated to each file's own parser via the optional
 * `Parser.resolveImport()` method (spec 030) — a parser that doesn't
 * implement it (its language has no imports, or none worth resolving) is
 * silently skipped, same as before this refactor. This is what lets a new
 * language's import resolution live entirely in its own parser file instead
 * of a hardcoded extension-set branch here.
 */
function resolveImportsInto(rawImports: RawFileImports[], nodeMap: Map<string, Node>, edgesSet: Set<string>): void {
  if (rawImports.length === 0) return;

  const knownFileIds = new Set<string>();
  const knownFilesByPath = new Map<string, string>();
  for (const node of nodeMap.values()) {
    if (node.type !== 'file') continue;
    knownFileIds.add(node.id);
    knownFilesByPath.set(node.file, node.id);
  }

  for (const { filePath, ext, imports } of rawImports) {
    const sourceId = knownFilesByPath.get(filePath);
    if (!sourceId) continue; // shouldn't happen — the file that emitted these imports is always its own node

    const parser = selectParser(ext);
    if (!parser?.resolveImport) continue;

    for (const specifier of imports) {
      for (const targetId of parser.resolveImport(specifier, filePath, knownFileIds, knownFilesByPath)) {
        edgesSet.add(edgeKey({ source: sourceId, target: targetId, relation: 'imports' }));
      }
    }
  }
}

function edgeKey(edge: Edge): string {
  return `${edge.source}|${edge.target}|${edge.relation}`;
}

function edgesFromSet(edgesSet: Set<string>): Edge[] {
  const edgesMap = new Map<string, Edge>();
  for (const key of edgesSet) {
    const [source, target, relation] = key.split('|');
    edgesMap.set(key, {
      source,
      target,
      relation: relation as Edge['relation'],
    });
  }
  return Array.from(edgesMap.values());
}

function buildStats(fileCount: number, nodes: Node[], edges: Edge[]): Graph['stats'] {
  return {
    files: fileCount,
    functions: nodes.filter(n => n.type === 'function').length,
    classes: nodes.filter(n => n.type === 'class').length,
    interfaces: nodes.filter(n => n.type === 'interface').length,
    edges: edges.length,
  };
}

export function calculateNodeDegree(nodeId: string, edges: Edge[]): number {
  let degree = 0;
  for (const edge of edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      degree++;
    }
  }
  return degree;
}

export function deduplicateEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  const unique: Edge[] = [];

  for (const edge of edges) {
    const key = edgeKey(edge);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(edge);
    }
  }

  return unique;
}
