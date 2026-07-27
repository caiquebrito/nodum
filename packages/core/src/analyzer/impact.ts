import type { Graph } from '../types.js';

export interface ImpactedFile {
  nodeId: string;
  file: string;
  /** Hop distance from the origin node's file, via incoming imports edges. */
  distance: number;
}

export interface TraceImpactOptions {
  maxDepth?: number;
}

/**
 * BFS over incoming `imports` edges, starting from `nodeId`'s owning file
 * (resolved via that node's `file` field if `nodeId` isn't itself a file
 * node). Returns every file transitively reachable — i.e. every file that
 * would be affected by changing the target — excluding the origin file
 * itself. Cycle-safe via a visited set.
 */
export function traceImpact(graph: Graph, nodeId: string, options: TraceImpactOptions = {}): ImpactedFile[] {
  const startNode = graph.nodes.find(n => n.id === nodeId);
  if (!startNode) return [];

  const fileNodesByPath = new Map(graph.nodes.filter(n => n.type === 'file').map(n => [n.file, n]));
  const originFile = startNode.type === 'file' ? startNode : fileNodesByPath.get(startNode.file);
  if (!originFile) return [];

  const incomingImports = new Map<string, string[]>(); // target file id -> source file ids
  for (const edge of graph.edges) {
    if (edge.relation !== 'imports') continue;
    if (!incomingImports.has(edge.target)) incomingImports.set(edge.target, []);
    incomingImports.get(edge.target)!.push(edge.source);
  }

  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const visited = new Set<string>([originFile.id]);
  const result: ImpactedFile[] = [];
  let frontier = [originFile.id];
  let distance = 0;

  while (frontier.length > 0 && (options.maxDepth === undefined || distance < options.maxDepth)) {
    distance++;
    const next: string[] = [];
    for (const fileId of frontier) {
      for (const sourceId of incomingImports.get(fileId) ?? []) {
        if (visited.has(sourceId)) continue;
        visited.add(sourceId);
        next.push(sourceId);
      }
    }
    for (const id of next) {
      result.push({ nodeId: id, file: nodesById.get(id)?.file ?? id, distance });
    }
    frontier = next;
  }

  return result;
}
