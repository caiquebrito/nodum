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
  parseFilesInto(files, nodeMap, edgesSet, onProgress);

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
 * Correct today because edges never cross file boundaries (import
 * resolution doesn't exist yet — see spec 010) — eviction-by-file-membership
 * cannot orphan a cross-file edge, since no such edge exists.
 */
async function generateGraphIncremental(
  projectPath: string,
  previousGraph: Graph,
  previousFiles: FileManifest,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ graph: Graph; files: FileManifest }> {
  const diff = await discoverChangedFiles(projectPath, previousFiles);
  const removedPaths = new Set<string>([...diff.deletedPaths, ...diff.changed.map(f => f.path)]);

  const survivingNodes = previousGraph.nodes.filter(n => !removedPaths.has(n.file));
  const survivingNodeIds = new Set(survivingNodes.map(n => n.id));
  const survivingEdges = previousGraph.edges.filter(
    e => survivingNodeIds.has(e.source) && survivingNodeIds.has(e.target),
  );

  const nodeMap = new Map<string, Node>(survivingNodes.map(n => [n.id, n]));
  const edgesSet = new Set<string>(survivingEdges.map(e => `${e.source}|${e.target}|${e.relation}`));
  parseFilesInto(diff.changed, nodeMap, edgesSet, onProgress);

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

function parseFilesInto(
  files: FileInfo[],
  nodeMap: Map<string, Node>,
  edgesSet: Set<string>,
  onProgress?: (processed: number, total: number) => void,
): void {
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
      const { nodes, edges: fileEdges } = parser.parse(file);

      for (const node of nodes) {
        if (!nodeMap.has(node.id)) {
          nodeMap.set(node.id, node);
        }
      }

      for (const edge of fileEdges) {
        edgesSet.add(`${edge.source}|${edge.target}|${edge.relation}`);
      }
    } catch {
      // Skip files with parse errors
    }

    processed++;
    onProgress?.(processed, total);
  }
}

function edgesFromSet(edgesSet: Set<string>): Edge[] {
  const edgesMap = new Map<string, Edge>();
  for (const edgeKey of edgesSet) {
    const [source, target, relation] = edgeKey.split('|');
    edgesMap.set(edgeKey, {
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
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(edge);
    }
  }

  return unique;
}
