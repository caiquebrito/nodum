import type { Graph } from '../types.js';

export interface Cycle {
  /** Node IDs forming the cycle, in traversal order. First and last are NOT repeated. */
  nodeIds: string[];
  /** File paths, same order as nodeIds, for human-readable reporting. */
  files: string[];
}

/**
 * Detects circular `imports` chains among file nodes. Returns one representative
 * cycle per strongly-connected component of size > 1 (or a single self-importing
 * node), computed via Tarjan's SCC algorithm, then a DFS within each SCC's
 * induced subgraph to recover one concrete cycle path.
 */
export function detectCycles(graph: Graph): Cycle[] {
  const importEdges = graph.edges.filter(e => e.relation === 'imports');

  const adjacency = new Map<string, string[]>();
  for (const edge of importEdges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  const sccs = tarjanSCC(adjacency);
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

  const cycles: Cycle[] = [];
  for (const scc of sccs) {
    const hasSelfLoop = scc.length === 1 && (adjacency.get(scc[0]) ?? []).includes(scc[0]);
    if (scc.length < 2 && !hasSelfLoop) continue;

    const path = findCyclePath(scc, adjacency);
    cycles.push({
      nodeIds: path,
      files: path.map(id => nodesById.get(id)?.file ?? id),
    });
  }

  return cycles;
}

/**
 * Iterative Tarjan's SCC algorithm (recursion would blow the stack on large,
 * deeply-linear import chains). Returns one array of node IDs per SCC,
 * including singleton components.
 */
function tarjanSCC(adjacency: Map<string, string[]>): string[][] {
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let nextIndex = 0;

  const allNodes = new Set<string>();
  for (const [source, targets] of adjacency) {
    allNodes.add(source);
    for (const target of targets) allNodes.add(target);
  }

  type Frame = { node: string; neighborIdx: number };

  for (const start of allNodes) {
    if (indices.has(start)) continue;

    const callStack: Frame[] = [{ node: start, neighborIdx: 0 }];
    indices.set(start, nextIndex);
    lowlink.set(start, nextIndex);
    nextIndex++;
    stack.push(start);
    onStack.add(start);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.neighborIdx < neighbors.length) {
        const neighbor = neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        if (!indices.has(neighbor)) {
          indices.set(neighbor, nextIndex);
          lowlink.set(neighbor, nextIndex);
          nextIndex++;
          stack.push(neighbor);
          onStack.add(neighbor);
          callStack.push({ node: neighbor, neighborIdx: 0 });
        } else if (onStack.has(neighbor)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, indices.get(neighbor)!));
        }
      } else {
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
        }

        if (lowlink.get(frame.node) === indices.get(frame.node)) {
          const scc: string[] = [];
          let member: string;
          do {
            member = stack.pop()!;
            onStack.delete(member);
            scc.push(member);
          } while (member !== frame.node);
          sccs.push(scc);
        }
      }
    }
  }

  return sccs;
}

/**
 * DFS restricted to the SCC's own node set, starting from an arbitrary member.
 * Since the component is strongly connected (or a self-loop), a back-edge
 * cycle is guaranteed to exist and this returns the first one found.
 */
function findCyclePath(scc: string[], adjacency: Map<string, string[]>): string[] {
  const sccSet = new Set(scc);
  const start = scc[0];

  if (scc.length === 1) return [start];

  const visited = new Set<string>();
  const pathIndex = new Map<string, number>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    pathIndex.set(node, path.length);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!sccSet.has(neighbor)) continue;

      if (pathIndex.has(neighbor)) {
        return path.slice(pathIndex.get(neighbor)!);
      }

      if (!visited.has(neighbor)) {
        const found = dfs(neighbor);
        if (found) return found;
      }
    }

    path.pop();
    pathIndex.delete(node);
    return null;
  }

  return dfs(start) ?? [start];
}
