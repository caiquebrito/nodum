/**
 * Smart context injection for Claude
 * Only includes relevant parts of the graph based on query, instead of
 * dumping the entire graph. Token savings are computed per call against a
 * real full-graph-dump baseline (see `buildRawGraphDump` / spec 026) rather
 * than asserted as a fixed percentage.
 */

import { ConversationCache } from "./conversation-cache.js";
import {
  cosineSimilarity,
  semanticScoreNodes,
  mergeScores,
  getTopScoredNodes,
  findSemanticNeighbors,
} from "./semantic-search.js";
import { generateQueryEmbedding, hasEmbeddings } from "./embeddings.js";
import { countTokens } from "@caiquebrito/nodum-core";

/**
 * `buildSmartContext()`'s result: the formatted text plus its approximate
 * token count (see `countTokens` — this is a stand-in tokenizer, not
 * Claude's real one, hence `approxTokens` rather than `tokens`).
 */
export interface SmartContextResult {
  text: string;
  approxTokens: number;
}

function withTokenCount(text: string): SmartContextResult {
  return { text, approxTokens: countTokens(text) };
}

interface Graph {
  project: string;
  stats: any;
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    group?: string;
    file?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
  }>;
  clusters?: Array<{
    id: string;
    label: string;
    summary: string;
    types: string[];
    externalDeps: string[];
    nodeIds: string[];
  }>;
  nodeToCluster?: { [nodeId: string]: string };
}

/**
 * Extract keywords from query for graph search
 * Examples:
 * - "What's the auth flow?" → ["auth", "flow", "login"]
 * - "Find API endpoints" → ["api", "endpoint", "route"]
 */
export function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "what", "is", "the", "a", "an", "and", "or", "in", "of", "to", "for",
    "from", "by", "with", "as", "can", "does", "do", "did", "how", "why",
    "where", "when", "that", "this", "these", "those", "i", "you", "we",
    "me", "my", "your", "all", "each", "every", "both", "any", "some"
  ]);

  return query
    .toLowerCase()
    .split(/[\s\-_\.\/]+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Score how relevant a node is to the query
 * Higher score = more relevant
 */
export function scoreNode(
  node: Graph["nodes"][0],
  keywords: string[]
): number {
  let score = 0;

  for (const keyword of keywords) {
    // Exact match in label (highest priority)
    if (node.label.toLowerCase() === keyword) {
      score += 10;
    }
    // Contains keyword in label
    if (node.label.toLowerCase().includes(keyword)) {
      score += 5;
    }
    // Contains keyword in file path
    if (node.file && node.file.toLowerCase().includes(keyword)) {
      score += 2;
    }
    // Match in type (function vs class)
    if (keyword === node.type) {
      score += 3;
    }
  }

  return score;
}

/**
 * Find nodes relevant to query
 * Returns sorted list with highest-scored nodes first
 */
export function findRelevantNodes(
  keywords: string[],
  nodes: Graph["nodes"],
  limit: number = 20
): Graph["nodes"] {
  return nodes
    .map(node => ({
      node,
      score: scoreNode(node, keywords)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ node }) => node);
}

// Per-seed neighbor cap and a hard ceiling on the total expanded set — see
// spec 027. Before this, a query matching one heavily-imported hub node
// could pull in every one of its dependents with no bound at all.
const MAX_NEIGHBORS_PER_SEED = 10;
const MAX_EXPANDED_NODES = 150;

/**
 * Expand context to include connected nodes (depth 1)
 * If user asks about "auth", also include what auth calls and what calls auth
 */
function expandContext(
  nodes: Graph["nodes"],
  edges: Graph["edges"],
  nodeMap: Map<string, Graph["nodes"][0]>
): Set<string> {
  // Adjacency built once (O(edges)) instead of re-scanning every edge per
  // seed node (O(seeds × edges)).
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (nodeMap.has(edge.target)) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source)!.push(edge.target);
    }
    if (nodeMap.has(edge.source)) {
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      incoming.get(edge.target)!.push(edge.source);
    }
  }

  const relevant = new Set<string>();

  for (const node of nodes) {
    if (relevant.size >= MAX_EXPANDED_NODES) break;
    relevant.add(node.id);

    // Add outgoing edges (what this node calls/imports), capped
    for (const target of (outgoing.get(node.id) ?? []).slice(0, MAX_NEIGHBORS_PER_SEED)) {
      if (relevant.size >= MAX_EXPANDED_NODES) break;
      relevant.add(target);
    }

    // Add incoming edges (what calls/imports this node), capped
    for (const source of (incoming.get(node.id) ?? []).slice(0, MAX_NEIGHBORS_PER_SEED)) {
      if (relevant.size >= MAX_EXPANDED_NODES) break;
      relevant.add(source);
    }
  }

  return relevant;
}

/**
 * Format relevant nodes and edges as readable text for Claude
 * v2.0: Shows cluster summaries instead of listing every node individually
 */
function formatContextText(
  relevantIds: Set<string>,
  graph: Graph
): string {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const nodeToCluster = graph.nodeToCluster ? new Map(Object.entries(graph.nodeToCluster)) : new Map();
  const clusters = (graph.clusters || []) as any[];
  const clusterMap = new Map(clusters.map(c => [c.id, c]));

  const lines: string[] = [];

  // Group nodes by cluster or file
  const nodesBySection = new Map<string, { type: string; nodes: any[]; clusterId?: string }>();
  const shownClusters = new Set<string>();

  for (const id of relevantIds) {
    const node = nodeMap.get(id);
    if (!node) continue;

    const clusterId = nodeToCluster.get(id);
    if (clusterId && !shownClusters.has(clusterId)) {
      // Show cluster summary instead of individual nodes
      const cluster = clusterMap.get(clusterId);
      if (cluster) {
        const sectionKey = `cluster_${clusterId}`;
        nodesBySection.set(sectionKey, {
          type: "cluster",
          nodes: [cluster],
          clusterId,
        });
        shownClusters.add(clusterId);
        continue;
      }
    }

    // Non-clustered node: group by file
    const file = node.file || "unknown";
    if (!nodesBySection.has(file)) {
      nodesBySection.set(file, { type: "file", nodes: [] });
    }
    nodesBySection.get(file)!.nodes.push(node);
  }

  // Format by section (clusters first, then files)
  const clusters_first = Array.from(nodesBySection.entries()).sort(([keyA]: [string, any], [keyB]: [string, any]) => {
    const aIsCluster = keyA.startsWith("cluster_");
    const bIsCluster = keyB.startsWith("cluster_");
    return aIsCluster === bIsCluster ? 0 : aIsCluster ? -1 : 1;
  });

  for (const [sectionKey, section] of clusters_first) {
    if (section.type === "cluster") {
      const cluster = section.nodes[0];
      lines.push(
        `🔗 ${cluster.label}\n` +
        `   ${cluster.summary}\n` +
        `   Types: ${cluster.types.join(", ")}\n` +
        `   External deps: ${cluster.externalDeps.slice(0, 3).map((id: string) => nodeMap.get(id)?.label || id).join(", ") || "none"}`
      );
    } else {
      // File section
      lines.push(`📄 ${sectionKey}`);
      for (const node of section.nodes) {
        const prefix = node.type === "file" ? "├" : "  ├";
        const type = node.type === "file" ? "📁" : "⚙️";

        const outgoing = graph.edges
          .filter(e => e.source === node.id)
          .map(e => nodeMap.get(e.target)?.label || e.target)
          .slice(0, 3);

        const incoming = graph.edges
          .filter(e => e.target === node.id)
          .map(e => nodeMap.get(e.source)?.label || e.source)
          .slice(0, 2);

        lines.push(
          `${prefix} ${type} ${node.label} (${node.type})${
            outgoing.length > 0 ? ` → ${outgoing.join(", ")}` : ""
          }${incoming.length > 0 ? ` ← ${incoming.join(", ")}` : ""}`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Plain-text dump of every node and edge — the "no smart context" baseline
 * `estimateTokenSavings()` compares against. Deliberately unformatted (no
 * clustering, no truncation) since it represents the cost of NOT doing any
 * of that.
 */
function buildRawGraphDump(graph: Graph): string {
  const nodeLines = graph.nodes.map(
    (n) => `${n.id} | ${n.label} (${n.type}) | ${n.file ?? ""}`
  );
  const edgeLines = graph.edges.map(
    (e) => `${e.source} -> ${e.target} (${e.relation})`
  );
  return [`Project: ${graph.project}`, ...nodeLines, ...edgeLines].join("\n");
}

/**
 * Main function: Build smart context for a query
 * Returns formatted text suitable for Claude's system prompt
 * v2.0: Uses semantic search + caching for best token efficiency
 */
export async function buildSmartContext(
  query: string,
  graph: Graph,
  maxNodes: number = 25,
  cache?: ConversationCache
): Promise<SmartContextResult> {
  // 1. Extract keywords from query
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    // Fallback: return summary if no keywords found
    return withTokenCount(
      `Project: ${graph.project}\nFiles: ${graph.stats.files} | Functions: ${graph.stats.functions} | Classes: ${graph.stats.classes}\n\n(Query didn't match specific nodes. Use search_graph tool for better results.)`
    );
  }

  // 2. Check cache for related context (if cache enabled)
  let expandedIds = new Set<string>();
  let cacheHit = false;

  if (cache) {
    const cachedContext = cache.getRelatedContext(graph.project, keywords);
    if (cachedContext) {
      expandedIds = cachedContext.expandedIds;
      cacheHit = true;
    }
  }

  // 3. If no cache hit, find relevant nodes
  if (!cacheHit) {
    let relevant: Graph["nodes"];

    // Try semantic search if embeddings available (v2.0)
    if (hasEmbeddings(graph.nodes as any)) {
      const queryEmbedding = await generateQueryEmbedding(query);

      if (queryEmbedding.length > 0) {
        // Semantic search: find similar nodes
        const semanticResults = semanticScoreNodes(
          queryEmbedding,
          graph.nodes as any
        );

        // Keyword search for comparison
        const keywordResults = (findRelevantNodes(keywords, graph.nodes as any, 40) as any) || [];
        const keywordScoreMap = new Map(
          keywordResults.map((n: any, idx: number) => [n.id, 40 - idx])
        );

        // Merge results with hybrid scoring
        semanticResults.forEach((scored: any) => {
          scored.keywordScore = keywordScoreMap.get(scored.node.id) || 0;
        });

        const merged = mergeScores(semanticResults, 0.4, 0.6);
        relevant = getTopScoredNodes(merged, maxNodes) as any;

        // Extend with neighbors if needed
        if (relevant.length < maxNodes / 2) {
          relevant = findSemanticNeighbors(relevant as any, graph.nodes as any, maxNodes) as any;
        }
      } else {
        // Embedding generation failed, fall back to keyword search
        relevant = findRelevantNodes(keywords, graph.nodes as any, maxNodes);
      }
    } else {
      // No embeddings yet, use keyword search only
      relevant = findRelevantNodes(keywords, graph.nodes as any, maxNodes);
    }

    if (relevant.length === 0) {
      return withTokenCount(
        `No nodes found for: ${keywords.join(", ")}\n\nTry using search_graph tool with different keywords.`
      );
    }

    // Create node map for edge lookups
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    // Expand to include connected nodes
    expandedIds = expandContext(relevant, graph.edges, nodeMap);

    // Store in cache for next related query
    if (cache) {
      cache.cacheContext(graph.project, query, keywords, relevant.map(n => n.id), expandedIds);
    }
  }

  // 4. Format as readable text
  const contextText = formatContextText(expandedIds, graph);

  // 5. Return with summary (include cache hit indicator)
  const cacheIndicator = cacheHit ? " (📦 from cache)" : "";
  const hasSemanticSearch = hasEmbeddings(graph.nodes as any) ? " (🧠 semantic)" : "";
  const responseBody =
    `Knowledge Graph Context (${graph.project})${cacheIndicator}${hasSemanticSearch}\n` +
    `Found ${expandedIds.size} relevant nodes for: "${query}"\n\n` +
    contextText +
    `\n📊 Summary:\n` +
    `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
    `• Context includes: ${expandedIds.size} relevant nodes\n`;

  // Real, measured comparison against a full unfiltered dump of the graph —
  // not an asserted percentage. See spec 026.
  const rawDumpTokens = countTokens(buildRawGraphDump(graph));
  const { percentage } = estimateTokenSavings(rawDumpTokens, countTokens(responseBody));
  const notes = [
    `${percentage}% fewer tokens than a full graph dump`,
    cacheHit ? "served from cache" : null,
    !cacheHit && hasEmbeddings(graph.nodes as any) ? "semantic search enabled" : null,
  ].filter((n): n is string => n !== null);

  const fullText = responseBody + `  (${notes.join(", ")})\n`;
  return { text: fullText, approxTokens: countTokens(fullText) };
}

/**
 * Build context for a specific node (get_node query)
 */
export function buildNodeContext(
  nodeId: string,
  graph: Graph
): string {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const node = nodeMap.get(nodeId);

  if (!node) {
    return `Node not found: ${nodeId}`;
  }

  const outgoing = graph.edges
    .filter(e => e.source === nodeId)
    .map(e => ({
      target: nodeMap.get(e.target),
      relation: e.relation
    }))
    .filter(e => e.target);

  const incoming = graph.edges
    .filter(e => e.target === nodeId)
    .map(e => ({
      source: nodeMap.get(e.source),
      relation: e.relation
    }))
    .filter(e => e.source);

  const lines: string[] = [
    `📍 ${node.label}`,
    `   Type: ${node.type}`,
    `   File: ${node.file || "unknown"}`,
    `   Group: ${node.group || "other"}`,
    ""
  ];

  if (outgoing.length > 0) {
    lines.push(`🔗 Dependencies (${outgoing.length}):`);
    outgoing.slice(0, 10).forEach(e => {
      lines.push(`   • ${e.target?.label} (${e.relation})`);
    });
    if (outgoing.length > 10) {
      lines.push(`   ... and ${outgoing.length - 10} more`);
    }
    lines.push("");
  }

  if (incoming.length > 0) {
    lines.push(`↑ Used by (${incoming.length}):`);
    incoming.slice(0, 10).forEach(e => {
      lines.push(`   • ${e.source?.label}`);
    });
    if (incoming.length > 10) {
      lines.push(`   ... and ${incoming.length - 10} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Estimate token savings from smart context
 */
export function estimateTokenSavings(
  fullGraphTokens: number,
  smartContextTokens: number
): { saved: number; percentage: number } {
  if (fullGraphTokens <= 0) return { saved: 0, percentage: 0 };
  const saved = fullGraphTokens - smartContextTokens;
  const percentage = Math.round((saved / fullGraphTokens) * 100);
  return { saved, percentage };
}
