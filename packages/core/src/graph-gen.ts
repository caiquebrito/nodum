import { basename } from 'path';
import { discoverFiles } from './file-discovery.js';
import { selectParser } from './parser/index.js';
import type { Graph, Node, Edge } from './types.js';

export async function generateGraph(
  projectPath: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<Graph> {
  const files = await discoverFiles(projectPath);
  const nodeMap = new Map<string, Node>();
  const edgesSet = new Set<string>();
  const edges: Edge[] = [];

  const total = files.length;
  let processed = 0;
  onProgress?.(0, total);

  // Parse all files
  for (const file of files) {
    const parser = selectParser(file.ext);
    if (!parser) {
      processed++;
      onProgress?.(processed, total);
      continue;
    }

    try {
      const { nodes, edges: fileEdges } = parser.parse(file);

      // Add nodes
      for (const node of nodes) {
        if (!nodeMap.has(node.id)) {
          nodeMap.set(node.id, node);
        }
      }

      // Track edges (deduplicate)
      for (const edge of fileEdges) {
        const edgeKey = `${edge.source}|${edge.target}|${edge.relation}`;
        edgesSet.add(edgeKey);
      }
    } catch {
      // Skip files with parse errors
    }

    processed++;
    onProgress?.(processed, total);
  }

  // Convert edge set back to array
  const edgesMap = new Map<string, Edge>();
  for (const edgeKey of edgesSet) {
    const [source, target, relation] = edgeKey.split('|');
    edgesMap.set(edgeKey, {
      source,
      target,
      relation: relation as Edge['relation'],
    });
  }
  edges.push(...edgesMap.values());

  // Calculate stats
  const nodes = Array.from(nodeMap.values());
  const stats = {
    files: files.length,
    functions: nodes.filter(n => n.type === 'function').length,
    classes: nodes.filter(n => n.type === 'class').length,
    interfaces: nodes.filter(n => n.type === 'interface').length,
    edges: edges.length,
  };

  const graph: Graph = {
    project: basename(projectPath),
    stats,
    nodes,
    edges,
  };

  return graph;
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
