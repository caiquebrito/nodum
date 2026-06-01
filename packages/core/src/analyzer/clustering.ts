/**
 * Hierarchical clustering for node compression
 * Groups related nodes into clusters and provides summaries
 * v2.0 Phase 3: 25% additional token reduction
 */

interface Node {
  id: string;
  label: string;
  type: string;
  file?: string;
  group?: string;
  embedding?: number[];
  clusterId?: string;
}

interface Edge {
  source: string;
  target: string;
  relation: string;
}

export interface NodeCluster {
  id: string;
  label: string;
  nodeCount: number;
  nodeIds: string[];
  summary: string;
  externalDeps: string[];
  types: string[];
}

/**
 * Build clusters from nodes using proximity heuristics
 * Groups nodes by: directory proximity, type similarity, connection density
 */
export function buildClusters(
  nodes: Node[],
  edges: Edge[]
): { clusters: NodeCluster[]; nodeToCluster: Map<string, string> } {
  const nodeToCluster = new Map<string, string>();
  const clusters: NodeCluster[] = [];
  const clusterId = new Map<string, string>();
  let clusterCounter = 0;

  // Group 1: By file/directory (highest priority)
  const nodesByFile = groupBy(
    nodes.filter(n => n.type !== "file"),
    n => n.file || "unknown"
  );

  for (const [file, fileNodes] of nodesByFile) {
    if (fileNodes.length > 3) {
      // Only cluster if 4+ nodes in file
      const id = `cluster_${clusterCounter++}`;
      fileNodes.forEach(n => {
        clusterId.set(n.id, id);
        nodeToCluster.set(n.id, id);
      });

      const types = [...new Set(fileNodes.map(n => n.type))];
      clusters.push({
        id,
        label: extractFileName(file),
        nodeCount: fileNodes.length,
        nodeIds: fileNodes.map(n => n.id),
        summary: generateClusterSummary(fileNodes, edges),
        externalDeps: findExternalDeps(fileNodes, edges, nodeToCluster),
        types,
      });
    }
  }

  // Group 2: By type + directory proximity (for remaining nodes)
  const unclustered = nodes.filter(
    n => !nodeToCluster.has(n.id) && n.type !== "file"
  );
  const nodesByType = groupBy(unclustered, n => n.type);

  for (const [type, typeNodes] of nodesByType) {
    if (typeNodes.length > 5) {
      // Cluster if 6+ nodes of same type
      const id = `cluster_${clusterCounter++}`;
      typeNodes.forEach(n => {
        clusterId.set(n.id, id);
        nodeToCluster.set(n.id, id);
      });

      clusters.push({
        id,
        label: `${type}s`,
        nodeCount: typeNodes.length,
        nodeIds: typeNodes.map(n => n.id),
        summary: generateClusterSummary(typeNodes, edges),
        externalDeps: findExternalDeps(typeNodes, edges, nodeToCluster),
        types: [type],
      });
    }
  }

  return { clusters, nodeToCluster };
}

/**
 * Generate a descriptive summary for a cluster
 */
function generateClusterSummary(nodes: Node[], edges: Edge[]): string {
  const types = [...new Set(nodes.map(n => n.type))].join(", ");
  const edgeCount = edges.filter(
    e =>
      nodes.some(n => n.id === e.source) &&
      nodes.some(n => n.id === e.target)
  ).length;

  const purposes = nodes
    .slice(0, 2)
    .map(n => n.label.toLowerCase())
    .join(", ");

  return `${nodes.length} ${types}${nodes.length > 1 ? "s" : ""} including ${purposes}${edgeCount > 0 ? `, ${edgeCount} internal connections` : ""}`;
}

/**
 * Find external dependencies (edges leaving the cluster)
 */
function findExternalDeps(
  nodes: Node[],
  edges: Edge[],
  nodeToCluster: Map<string, string>
): string[] {
  const externalTargets = new Set<string>();
  const nodeIds = new Set(nodes.map(n => n.id));

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && !nodeIds.has(edge.target)) {
      externalTargets.add(edge.target);
    }
  }

  return Array.from(externalTargets).slice(0, 5); // Top 5
}

/**
 * Find nodes that depend on the cluster
 */
export function findIncomingDeps(
  cluster: NodeCluster,
  edges: Edge[],
  nodeMap: Map<string, Node>
): string[] {
  const incomingIds = new Set<string>();
  const clusterNodeIds = new Set(cluster.nodeIds);

  for (const edge of edges) {
    if (
      clusterNodeIds.has(edge.target) &&
      !clusterNodeIds.has(edge.source)
    ) {
      incomingIds.add(edge.source);
    }
  }

  return Array.from(incomingIds).slice(0, 5);
}

/**
 * Expand a cluster to show all member details
 */
export function expandCluster(
  cluster: NodeCluster,
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; internalEdges: Edge[]; externalEdges: Edge[] } {
  const memberNodes = nodes.filter(n => cluster.nodeIds.includes(n.id));
  const clusterNodeSet = new Set(cluster.nodeIds);

  const internalEdges = edges.filter(
    e =>
      clusterNodeSet.has(e.source) && clusterNodeSet.has(e.target)
  );

  const externalEdges = edges.filter(
    e =>
      (clusterNodeSet.has(e.source) && !clusterNodeSet.has(e.target)) ||
      (clusterNodeSet.has(e.target) && !clusterNodeSet.has(e.source))
  );

  return {
    nodes: memberNodes,
    internalEdges,
    externalEdges,
  };
}

/**
 * Check if a node should be shown in cluster summary vs expanded
 */
export function isClusteredNode(nodeId: string, nodeToCluster: Map<string, string>): boolean {
  return nodeToCluster.has(nodeId);
}

/**
 * Get cluster ID for a node
 */
export function getClusterIdForNode(
  nodeId: string,
  nodeToCluster: Map<string, string>
): string | undefined {
  return nodeToCluster.get(nodeId);
}

/**
 * Helper: Group array by key function
 */
function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }
  return groups;
}

/**
 * Extract filename from file path
 */
function extractFileName(filePath: string): string {
  const parts = filePath.split(/[\/\\]/);
  const filename = parts[parts.length - 1] || filePath;
  return filename.replace(/\.[^/.]+$/, "");
}
