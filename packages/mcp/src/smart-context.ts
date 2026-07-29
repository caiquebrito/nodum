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
import type { Graph } from "@caiquebrito/nodum-core";

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
 * One renderable unit of context — a cluster summary or a file's group of
 * nodes. `nodeCount` is how many of `relevantIds` this section accounts
 * for, used to report an accurate "included" count when a token budget
 * (spec 041) cuts the section list short.
 */
interface ContextSection {
  text: string;
  nodeCount: number;
}

/**
 * Split relevant nodes/clusters into one section per cluster-or-file, in
 * the order first encountered while iterating `relevantIds`. Iteration
 * order there already reflects relevance priority — `expandContext`
 * (below) adds each seed immediately followed by its own neighbors, in
 * seed-relevance order, and `Set` iteration in JS follows insertion order
 * — so this section order doubles as a priority order a budget-limited
 * caller can truncate against (spec 041). Earlier versions of this
 * function re-sorted clusters ahead of files after grouping, which broke
 * that priority ordering for no benefit besides visual grouping — removed.
 */
function buildContextSections(
  relevantIds: Set<string>,
  graph: Graph
): ContextSection[] {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const nodeToCluster = graph.nodeToCluster ? new Map(Object.entries(graph.nodeToCluster)) : new Map();
  const clusters = (graph.clusters || []) as any[];
  const clusterMap = new Map(clusters.map(c => [c.id, c]));

  // Group nodes by cluster or file, in first-encountered order.
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

  const sections: ContextSection[] = [];

  for (const [sectionKey, section] of nodesBySection) {
    if (section.type === "cluster") {
      const cluster = section.nodes[0];
      // A cluster section "accounts for" every relevant id that collapsed
      // into it, not just 1 — matters for the included-node count under a
      // token budget.
      const clusterNodeCount = Array.from(relevantIds).filter(id => nodeToCluster.get(id) === cluster.id).length;
      sections.push({
        nodeCount: clusterNodeCount,
        text:
          `🔗 ${cluster.label}\n` +
          `   ${cluster.summary}\n` +
          `   Types: ${cluster.types.join(", ")}\n` +
          `   External deps: ${cluster.externalDeps.slice(0, 3).map((id: string) => nodeMap.get(id)?.label || id).join(", ") || "none"}`,
      });
    } else {
      // File section
      const lines = [`📄 ${sectionKey}`];
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
      sections.push({ text: lines.join("\n"), nodeCount: section.nodes.length });
    }
  }

  return sections;
}

/**
 * Format relevant nodes and edges as readable text for Claude — the
 * unbudgeted path (no `tokenBudget`), unchanged in output from before
 * spec 041 besides the ordering fix documented on `buildContextSections`.
 */
function formatContextText(
  relevantIds: Set<string>,
  graph: Graph
): string {
  return buildContextSections(relevantIds, graph)
    .map(s => s.text)
    .join("\n\n");
}

/**
 * Greedily fills sections into `tokenBudget`, in priority order, stopping
 * once the next section would exceed it. Cost accounting is per-section
 * incremental (`countTokens` on each new section only, summed as sections
 * are added) rather than a full-string recount every iteration — cheap,
 * and avoids O(n²) cost on a large expanded set. This is an approximation
 * (consistent with the `approxTokens` naming convention, spec 024): BPE
 * tokenization isn't perfectly additive across concatenation boundaries,
 * so the true joined text's token count can differ by a handful of tokens
 * from the sum of its parts' counts — acceptable for a budget that's
 * itself approximate.
 */
function fillSectionsToBudget(
  sections: ContextSection[],
  tokenBudget: number
): { text: string; includedNodeCount: number; truncated: boolean } {
  let used = 0;
  const included: string[] = [];
  let includedNodeCount = 0;

  for (const section of sections) {
    const cost = countTokens(section.text) + 2; // +2 for the "\n\n" joiner
    // The single highest-priority section always gets included, even if it
    // alone exceeds `tokenBudget` — an empty response is a worse outcome
    // than a modest overshoot on a budget that's already approximate. Every
    // section after the first is a hard stop.
    if (included.length > 0 && used + cost > tokenBudget) {
      return { text: included.join("\n\n"), includedNodeCount, truncated: true };
    }
    included.push(section.text);
    used += cost;
    includedNodeCount += section.nodeCount;
  }

  return { text: included.join("\n\n"), includedNodeCount, truncated: false };
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
 * Options for `buildSmartContext` (spec 041 replaced the old positional
 * `(query, graph, maxNodes, cache)` signature with this — small enough
 * call-site count, at the time of the change, to migrate cleanly rather
 * than keep a positional back-compat overload).
 */
export interface SmartContextOptions {
  /** Pre-filter cap on seed candidates before expansion. Default 25. */
  maxNodes?: number;
  /**
   * If given, sections are greedily included in relevance-priority order
   * until the next one would exceed this many (approximate) tokens,
   * instead of the unlimited `maxNodes`/`MAX_EXPANDED_NODES`-only cap.
   * The single highest-priority section always gets included even if it
   * alone exceeds the budget — see `fillSectionsToBudget`.
   */
  tokenBudget?: number;
  cache?: ConversationCache;
  /**
   * Restricts search *candidates* to nodes of this type before scoring —
   * previously accepted by `handleSearch` but silently ignored (a dead
   * parameter, fixed here). Deliberately does **not** restrict
   * `expandContext`'s neighbor lookup, so a search for `type: "function"`
   * still shows which file each match lives in — the filter narrows what
   * counts as a match, not what's allowed to appear as surrounding
   * context. A `typeFilter` also bypasses the conversation cache: cache
   * hits are matched by keyword similarity only, with no awareness of
   * `typeFilter`, so reusing a cached result here could silently ignore
   * the filter — simplest correct fix is to not consult the cache at all
   * when a filter is active.
   */
  typeFilter?: string;
}

/**
 * Main function: Build smart context for a query
 * Returns formatted text suitable for Claude's system prompt
 * v2.0: Uses semantic search + caching for best token efficiency
 */
export async function buildSmartContext(
  query: string,
  graph: Graph,
  options: SmartContextOptions = {}
): Promise<SmartContextResult> {
  const { maxNodes = 25, tokenBudget, cache, typeFilter } = options;

  // 1. Extract keywords from query
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    // Fallback: return summary if no keywords found
    return withTokenCount(
      `Project: ${graph.project}\nFiles: ${graph.stats.files} | Functions: ${graph.stats.functions} | Classes: ${graph.stats.classes}\n\n(Query didn't match specific nodes. Use search_graph tool for better results.)`
    );
  }

  // 2. Check cache for related context (if cache enabled and no type
  // filter — see SmartContextOptions.typeFilter's doc comment)
  let expandedIds = new Set<string>();
  let cacheHit = false;

  if (cache && !typeFilter) {
    const cachedContext = cache.getRelatedContext(graph.project, keywords);
    if (cachedContext) {
      expandedIds = cachedContext.expandedIds;
      cacheHit = true;
    }
  }

  // 3. If no cache hit, find relevant nodes
  if (!cacheHit) {
    // Restrict candidates to the requested type, if any — narrows what
    // counts as a *match*; expansion below can still surface nodes of any
    // type as context around a match.
    const candidateNodes = typeFilter ? graph.nodes.filter(n => n.type === typeFilter) : graph.nodes;

    let relevant: Graph["nodes"];

    // Try semantic search if embeddings available (v2.0)
    if (hasEmbeddings(candidateNodes as any)) {
      const queryEmbedding = await generateQueryEmbedding(query);

      if (queryEmbedding.length > 0) {
        // Semantic search: find similar nodes
        const semanticResults = semanticScoreNodes(
          queryEmbedding,
          candidateNodes as any
        );

        // Keyword search for comparison
        const keywordResults = (findRelevantNodes(keywords, candidateNodes as any, 40) as any) || [];
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
          relevant = findSemanticNeighbors(relevant as any, candidateNodes as any, maxNodes) as any;
        }
      } else {
        // Embedding generation failed, fall back to keyword search
        relevant = findRelevantNodes(keywords, candidateNodes as any, maxNodes);
      }
    } else {
      // No embeddings yet, use keyword search only
      relevant = findRelevantNodes(keywords, candidateNodes as any, maxNodes);
    }

    if (relevant.length === 0) {
      return withTokenCount(
        `No nodes found for: ${keywords.join(", ")}${typeFilter ? ` (type: ${typeFilter})` : ""}\n\nTry using search_graph tool with different keywords.`
      );
    }

    // Create node map for edge lookups — built from the FULL node set, not
    // `candidateNodes`, so a type-filtered search can still expand into
    // neighbors of other types.
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    // Expand to include connected nodes
    expandedIds = expandContext(relevant, graph.edges, nodeMap);

    // Store in cache for next related query (never for a type-filtered
    // search — see SmartContextOptions.typeFilter's doc comment)
    if (cache && !typeFilter) {
      cache.cacheContext(graph.project, query, keywords, relevant.map(n => n.id), expandedIds);
    }
  }

  // 4. Format as readable text — budgeted (spec 041) or unlimited
  const cacheIndicator = cacheHit ? " (📦 from cache)" : "";
  const hasSemanticSearch = hasEmbeddings(graph.nodes as any) ? " (🧠 semantic)" : "";
  const headerText =
    `Knowledge Graph Context (${graph.project})${cacheIndicator}${hasSemanticSearch}\n` +
    `Found ${expandedIds.size} relevant nodes for: "${query}"\n\n`;

  const sections = buildContextSections(expandedIds, graph);

  let contextText: string;
  let includedNodeCount: number;
  let truncated: boolean;

  if (tokenBudget !== undefined) {
    // Reserve the fixed overhead (header + footer + notes line) *before*
    // greedily filling sections, so the budget governs the TOTAL response,
    // not just the section text — the footer's own size barely varies with
    // the included count (a handful of digits either way), so a
    // worst-case-shaped placeholder is a close enough estimate for this
    // approximation.
    const footerEstimate =
      `\n📊 Summary:\n` +
      `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
      `• Context includes: ${expandedIds.size} relevant nodes (of ${expandedIds.size} found — cut short by token budget)\n` +
      `  (100% fewer tokens than a full graph dump, truncated to fit token budget)\n`;
    const fixedOverhead = countTokens(headerText) + countTokens(footerEstimate);
    const sectionBudget = Math.max(0, tokenBudget - fixedOverhead);

    const filled = fillSectionsToBudget(sections, sectionBudget);
    contextText = filled.text;
    includedNodeCount = filled.includedNodeCount;
    truncated = filled.truncated;
  } else {
    contextText = sections.map(s => s.text).join("\n\n");
    includedNodeCount = expandedIds.size;
    truncated = false;
  }

  // 5. Return with summary
  const responseBody =
    headerText +
    contextText +
    `\n📊 Summary:\n` +
    `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
    `• Context includes: ${includedNodeCount} relevant nodes${truncated ? ` (of ${expandedIds.size} found — cut short by token budget)` : ""}\n`;

  // Real, measured comparison against a full unfiltered dump of the graph —
  // not an asserted percentage. See spec 026.
  const rawDumpTokens = countTokens(buildRawGraphDump(graph));
  const { percentage } = estimateTokenSavings(rawDumpTokens, countTokens(responseBody));
  const notes = [
    `${percentage}% fewer tokens than a full graph dump`,
    cacheHit ? "served from cache" : null,
    !cacheHit && hasEmbeddings(graph.nodes as any) ? "semantic search enabled" : null,
    truncated ? "truncated to fit token budget" : null,
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
