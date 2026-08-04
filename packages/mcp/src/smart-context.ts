/**
 * Smart context injection for Claude
 * Only includes relevant parts of the graph based on query, instead of
 * dumping the entire graph. Token savings are computed per call against a
 * real full-graph-dump baseline (see `rawDumpApproxTokens` / spec 026, cached
 * at sync time per spec 069) rather than asserted as a fixed percentage.
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
import { countTokens, buildRawGraphDumpText } from "@caiquebrito/nodum-core";
import type { Graph } from "@caiquebrito/nodum-core";
import { tokenizeIdentifier } from "./identifier-tokenize.js";

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
 *
 * The length filter used to be `word.length > 2`, which silently dropped
 * real, common identifier fragments like `id`, `db`, `ui`, `io` (spec 068).
 * Lowered to `word.length > 1` and paired with an explicit stop-list for the
 * 1-2 char tokens that really are noise (articles/prepositions/pronouns not
 * already caught by `stopWords` at 3+ chars) — a blanket length cutoff can't
 * tell "id" from "is", but an explicit list can.
 */
export function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "what", "is", "the", "a", "an", "and", "or", "in", "of", "to", "for",
    "from", "by", "with", "as", "can", "does", "do", "did", "how", "why",
    "where", "when", "that", "this", "these", "those", "i", "you", "we",
    "me", "my", "your", "all", "each", "every", "both", "any", "some",
    // Short (1-2 char) noise words recovered by lowering the length filter
    // below from >2 to >1 — added explicitly so genuinely meaningful short
    // identifier fragments (id, db, ui, io, ...) aren't caught by a blanket
    // cutoff instead.
    "on", "at", "up", "if", "no", "so", "am", "be", "us", "ok", "go", "vs",
    "he", "it"
  ]);

  return query
    .toLowerCase()
    .split(/[\s\-_\.\/]+/)
    .filter(word => word.length > 1 && !stopWords.has(word));
}

/**
 * A per-graph index from split identifier term -> the set of node ids whose
 * label contains that term, plus each term's IDF weight computed from that
 * same index (spec 068). Built once per `buildSmartContext` call (or once
 * per `findRelevantNodes` call when no index is supplied — see that
 * function) rather than recomputed per keyword or per node: `graph.nodes`
 * can run into the thousands, and every keyword in a query would otherwise
 * re-scan every node's label.
 */
export interface TermIndex {
  /** term -> node ids whose tokenized label contains that term. */
  termToNodeIds: Map<string, Set<string>>;
  /** term -> idf(term), see `buildTermIndex` for the formula. */
  idf: Map<string, number>;
  totalNodes: number;
}

// Floor on a term's IDF weight (spec 068). The textbook formula
// `log(totalNodes / (1 + nodesContainingTerm))` goes to 0 or slightly
// negative once a term appears in nearly every node — correct in principle
// (a term with zero discriminating power should contribute ~nothing), but
// on the small graphs this repo's own tests and some real small projects
// use, "nearly every node" can be reached with a handful of matches, and a
// negative contribution could make an otherwise-real match's total score
// dip to or below 0 and get filtered out entirely by `findRelevantNodes`.
// Flooring keeps every real term match worth at least a small positive
// score while still weighting common terms far below rare ones.
const IDF_FLOOR = 0.1;

// The substring fallback below is deliberately a small, flat score (not
// IDF-scaled — it's not a real term-index membership). It must always score
// below the *minimum possible* term-match contribution
// (`TERM_MATCH_BASE_SCORE * IDF_FLOOR`), or a term appearing in a
// near-ubiquitous-vocabulary small graph (where its floored IDF weight is
// tiny) could lose to a coincidental substring match elsewhere — exactly
// the ordering spec 068 exists to fix. `TERM_MATCH_MIN_SCORE` enforces that
// invariant directly rather than depending on the two constants staying in
// the right relative order as either changes.
const TERM_MATCH_BASE_SCORE = 5;
const SUBSTRING_FALLBACK_SCORE = 2;
const TERM_MATCH_MIN_SCORE = SUBSTRING_FALLBACK_SCORE + 0.5;

/**
 * Builds the term index + IDF weights described on `TermIndex`, from each
 * node's tokenized label only (not file paths — extending to file paths is
 * a natural follow-up per spec 068's Design section, but adds noise from
 * directory names; measure before adding).
 */
export function buildTermIndex(nodes: Graph["nodes"]): TermIndex {
  const termToNodeIds = new Map<string, Set<string>>();

  for (const node of nodes) {
    const terms = new Set(tokenizeIdentifier(node.label));
    for (const term of terms) {
      let ids = termToNodeIds.get(term);
      if (!ids) {
        ids = new Set();
        termToNodeIds.set(term, ids);
      }
      ids.add(node.id);
    }
  }

  const totalNodes = nodes.length;
  const idf = new Map<string, number>();
  for (const [term, ids] of termToNodeIds) {
    idf.set(term, Math.log(totalNodes / (1 + ids.size)));
  }

  return { termToNodeIds, idf, totalNodes };
}

function idfWeight(termIndex: TermIndex | undefined, term: string): number {
  if (!termIndex) return 1;
  const raw = termIndex.idf.get(term);
  if (raw === undefined) return 1;
  return Math.max(raw, IDF_FLOOR);
}

/**
 * Score how relevant a node is to the query.
 * Higher score = more relevant.
 *
 * Replaces the old raw `label.includes(keyword)` substring check (spec 068)
 * with term-set intersection against the node's split identifier terms
 * (`tokenizeIdentifier`), so `user` matching `getUserById` is recognized as
 * a real term match rather than a coincidental substring — and so that
 * match's contribution is scaled by the term's IDF weight (rare terms like
 * `authenticate` count for more than near-ubiquitous ones like `get`). A
 * lower-weight, non-IDF-scaled substring fallback is kept for queries that
 * don't tokenize cleanly (e.g. a copy-pasted exact function name that isn't
 * one of the label's own split terms).
 *
 * `termIndex` is optional so this remains callable in isolation (as the
 * existing unit tests do) — without one, every term match falls back to a
 * neutral IDF weight of 1 (no weighting, same posture as the pre-068
 * behavior). `findRelevantNodes` always builds and passes a real index.
 */
export function scoreNode(
  node: Graph["nodes"][0],
  keywords: string[],
  termIndex?: TermIndex
): number {
  let score = 0;
  const labelLower = node.label.toLowerCase();
  const labelTerms = new Set(tokenizeIdentifier(node.label));

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();

    // Exact full-label match (highest priority) — an identity match, not a
    // term-frequency signal, so it's not IDF-scaled.
    if (labelLower === kw) {
      score += 10;
    }

    if (labelTerms.has(kw)) {
      // Exact split-term match, scaled by how discriminative the term is
      // across the graph's own vocabulary — but never below
      // TERM_MATCH_MIN_SCORE, so it always outranks the flat substring
      // fallback below regardless of how the IDF floor lands.
      score += Math.max(TERM_MATCH_BASE_SCORE * idfWeight(termIndex, kw), TERM_MATCH_MIN_SCORE);
    } else if (labelLower.includes(kw)) {
      // Substring fallback — lower, flat weight; not a real term match.
      score += SUBSTRING_FALLBACK_SCORE;
    }

    // Contains keyword in file path
    if (node.file && node.file.toLowerCase().includes(kw)) {
      score += 2;
    }
    // Match in type (function vs class)
    if (kw === node.type) {
      score += 3;
    }
  }

  return score;
}

/**
 * Find nodes relevant to query
 * Returns sorted list with highest-scored nodes first
 *
 * Builds a `TermIndex` once over `nodes` (spec 068) unless the caller
 * already has one (`buildSmartContext` builds a single index from the full
 * graph and passes it into every `findRelevantNodes` call it makes, so a
 * `typeFilter`-narrowed candidate set still scores against the whole
 * graph's term frequencies, not just the filtered subset's).
 */
export function findRelevantNodes(
  keywords: string[],
  nodes: Graph["nodes"],
  limit: number = 20,
  termIndex?: TermIndex
): Graph["nodes"] {
  const index = termIndex ?? buildTermIndex(nodes);
  return nodes
    .map(node => ({
      node,
      score: scoreNode(node, keywords, index)
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
 * source-id -> target-id[] / target-id -> source-id[] adjacency, keyed only
 * to edges whose *other* endpoint is present in `nodeMap` (spec 027's
 * existing filter). Built once per `buildSmartContext` call in
 * `buildGraphAdjacency` below and threaded into both `expandContext` and
 * `buildContextSections` (spec 070) — those two used to each derive this
 * same information independently, `expandContext` via one O(edges) pass and
 * `buildContextSections` via an O(nodes × edges) `graph.edges.filter(...)`
 * scan repeated per node.
 */
export interface GraphAdjacency {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

/**
 * Builds `GraphAdjacency` once from `graph.edges` — see that interface's doc
 * comment for why this is shared between `expandContext` and
 * `buildContextSections` rather than each rebuilding it (spec 070).
 */
function buildGraphAdjacency(
  edges: Graph["edges"],
  nodeMap: Map<string, Graph["nodes"][0]>
): GraphAdjacency {
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
  return { outgoing, incoming };
}

/**
 * Expand context to include connected nodes (depth 1)
 * If user asks about "auth", also include what auth calls and what calls auth
 */
function expandContext(
  nodes: Graph["nodes"],
  adjacency: GraphAdjacency
): Set<string> {
  const { outgoing, incoming } = adjacency;
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
  graph: Graph,
  adjacency: GraphAdjacency
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

        // Reuses the adjacency maps built once in `buildSmartContext` and
        // already passed to `expandContext` — spec 070. This used to be an
        // O(edges) `graph.edges.filter(...)` scan per node here (an
        // O(nodes × edges) rescan of the same information), even though
        // `expandContext` right before this had already built and thrown
        // away that exact adjacency.
        const outgoing = (adjacency.outgoing.get(node.id) ?? [])
          .map(id => nodeMap.get(id)?.label || id)
          .slice(0, 3);

        const incoming = (adjacency.incoming.get(node.id) ?? [])
          .map(id => nodeMap.get(id)?.label || id)
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
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const adjacency = buildGraphAdjacency(graph.edges, nodeMap);
  return buildContextSections(relevantIds, graph, adjacency)
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
 * Approximate token count of a full, unfiltered plain-text dump of every
 * node and edge — the "no smart context" baseline `estimateTokenSavings()`
 * compares against. Deliberately unformatted (no clustering, no truncation)
 * since it represents the cost of NOT doing any of that.
 *
 * Spec 069: this used to rebuild and retokenize that whole string on every
 * `search_graph` call even though the value doesn't depend on the query at
 * all — it's a property of the graph. Now it's computed once at sync time
 * and persisted as `graph.stats.rawDumpApproxTokens`
 * (`packages/core/src/graph-gen.ts`'s `buildStats()`); this only falls back
 * to the on-demand computation for a graph loaded from an older nodum
 * version that doesn't have the field yet.
 */
function rawDumpApproxTokens(graph: Graph): number {
  if (graph.stats.rawDumpApproxTokens !== undefined) {
    return graph.stats.rawDumpApproxTokens;
  }
  return countTokens(buildRawGraphDumpText(graph.project, graph.nodes, graph.edges));
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

  // Node map + adjacency built once here, from the FULL graph, and reused by
  // both `expandContext` (cache-miss path only) and `buildContextSections`
  // (always) below — spec 070. Previously `buildContextSections` derived
  // this same information itself via a per-node `graph.edges.filter(...)`
  // scan, redoing work `expandContext` had already done and discarded.
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const adjacency = buildGraphAdjacency(graph.edges, nodeMap);

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

    // Built once per call, from the FULL graph (not `candidateNodes`) — a
    // typeFilter narrows what counts as a match, but a term's IDF weight
    // should still reflect how common it is across the whole graph's
    // vocabulary, not just the filtered subset (spec 068).
    const termIndex = buildTermIndex(graph.nodes);

    let relevant: Graph["nodes"];

    // Try semantic search if embeddings available (v2.0)
    if (hasEmbeddings(candidateNodes as any, graph.embeddingVersion)) {
      const queryEmbedding = await generateQueryEmbedding(query);

      if (queryEmbedding.length > 0) {
        // Candidate pool for both rankers — wider than `maxNodes` so RRF
        // fusion has real signal to reconsider before truncating to the
        // final top-N (see spec 066).
        const candidateCount = Math.max(40, maxNodes * 4);

        // Semantic search: find similar nodes
        const semanticResults = semanticScoreNodes(
          queryEmbedding,
          candidateNodes as any,
          candidateCount
        );

        // Keyword search for comparison — wider candidate pool (spec 066)
        // and IDF-weighted term scoring against the whole-graph term index
        // (spec 068).
        const keywordResults = (findRelevantNodes(keywords, candidateNodes as any, candidateCount, termIndex) as any) || [];

        // Fuse both rankings via Reciprocal Rank Fusion — rank position,
        // not raw score, drives the fused order, so a 0-40 keyword rank and
        // a 0-1 cosine similarity combine safely (spec 066).
        const merged = mergeScores(semanticResults, keywordResults, 0.4, 0.6);
        relevant = getTopScoredNodes(merged, maxNodes) as any;

        // Extend with neighbors if needed
        if (relevant.length < maxNodes / 2) {
          relevant = findSemanticNeighbors(relevant as any, candidateNodes as any, maxNodes) as any;
        }
      } else {
        // Embedding generation failed, fall back to keyword search
        relevant = findRelevantNodes(keywords, candidateNodes as any, maxNodes, termIndex);
      }
    } else {
      // No embeddings yet, use keyword search only
      relevant = findRelevantNodes(keywords, candidateNodes as any, maxNodes, termIndex);
    }

    if (relevant.length === 0) {
      return withTokenCount(
        `No nodes found for: ${keywords.join(", ")}${typeFilter ? ` (type: ${typeFilter})` : ""}\n\nTry using search_graph tool with different keywords.`
      );
    }

    // Expand to include connected nodes — `nodeMap`/`adjacency` built above
    // from the FULL node set, not `candidateNodes`, so a type-filtered
    // search can still expand into neighbors of other types.
    expandedIds = expandContext(relevant, adjacency);

    // Store in cache for next related query (never for a type-filtered
    // search — see SmartContextOptions.typeFilter's doc comment)
    if (cache && !typeFilter) {
      cache.cacheContext(graph.project, query, keywords, relevant.map(n => n.id), expandedIds);
    }
  }

  // 4. Format as readable text — budgeted (spec 041) or unlimited
  const cacheIndicator = cacheHit ? " (📦 from cache)" : "";
  const hasSemanticSearch = hasEmbeddings(graph.nodes as any, graph.embeddingVersion) ? " (🧠 semantic)" : "";
  const headerText =
    `Knowledge Graph Context (${graph.project})${cacheIndicator}${hasSemanticSearch}\n` +
    `Found ${expandedIds.size} relevant nodes for: "${query}"\n\n`;

  const sections = buildContextSections(expandedIds, graph, adjacency);

  // Footer compression (spec 070): a session's first `search_graph` call
  // gets the full summary+notes footer; subsequent calls within the same
  // cached session get a short form (just the node count and truncation
  // flag — no repeated percentage/notes prose). Without a `cache`, session
  // state can't be tracked at all, so every call gets the full footer
  // (same as today's behavior).
  const showFullFooter = !cache || !cache.hasShownFullFooter(graph.project);

  let contextText: string;
  let includedNodeCount: number;
  let truncated: boolean;

  if (tokenBudget !== undefined) {
    // Reserve the fixed overhead (header + footer + notes line) *before*
    // greedily filling sections, so the budget governs the TOTAL response,
    // not just the section text — the footer's own size barely varies with
    // the included count (a handful of digits either way), so a
    // worst-case-shaped placeholder is a close enough estimate for this
    // approximation. Sized to whichever footer form this call will
    // actually emit, so a short-footer call doesn't reserve (and
    // needlessly give up section budget for) space it won't use.
    const footerEstimate = showFullFooter
      ? `\n📊 Summary:\n` +
        `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
        `• Context includes: ${expandedIds.size} relevant nodes (of ${expandedIds.size} found — cut short by token budget)\n` +
        `  (100% fewer tokens than a full graph dump, truncated to fit token budget)\n`
      : `\n📊 Context includes: ${expandedIds.size} relevant nodes (of ${expandedIds.size} found — cut short by token budget)\n`;
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
  if (cache && showFullFooter) {
    cache.markFooterShown(graph.project);
  }

  if (!showFullFooter) {
    // The truncated case keeps the exact phrase "truncated to fit token
    // budget" (not a paraphrase) because packages/mcp/src/index.ts's
    // `withMetrics` derives the `truncated` telemetry field (spec 065,
    // surfaced via `nodum metrics`, spec 070's own README rule #2) by
    // substring-matching this response text for that literal phrase — an
    // earlier version of this short footer said "cut short by token
    // budget" instead, which silently broke truncation detection on every
    // call after a session's first one.
    const shortResponseBody =
      headerText +
      contextText +
      `\n📊 Context includes: ${includedNodeCount} relevant nodes${truncated ? ` (of ${expandedIds.size} found — truncated to fit token budget)` : ""}\n`;
    return { text: shortResponseBody, approxTokens: countTokens(shortResponseBody) };
  }

  const responseBody =
    headerText +
    contextText +
    `\n📊 Summary:\n` +
    `• Total project: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n` +
    `• Context includes: ${includedNodeCount} relevant nodes${truncated ? ` (of ${expandedIds.size} found — cut short by token budget)` : ""}\n`;

  // Real, measured comparison against a full unfiltered dump of the graph —
  // not an asserted percentage. See spec 026. Only computed for the full
  // footer — the short form doesn't report this figure, so there's no
  // reason to pay for `rawDumpApproxTokens`'s (fallback-path) work on a
  // call that won't use it.
  const rawDumpTokens = rawDumpApproxTokens(graph);
  const { percentage } = estimateTokenSavings(rawDumpTokens, countTokens(responseBody));
  const notes = [
    `${percentage}% fewer tokens than a full graph dump`,
    cacheHit ? "served from cache" : null,
    !cacheHit && hasEmbeddings(graph.nodes as any, graph.embeddingVersion) ? "semantic search enabled" : null,
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
    // Only rendered when present (spec 049) — a non-Gradle/Kotlin project's
    // output stays byte-identical to before, same posture as spec 036's
    // optional Swift/ObjC stat lines.
    ...(node.sourceSet ? [`   Source set: ${node.sourceSet}`] : []),
    // Only rendered when present (spec 051), same posture as sourceSet above.
    ...(node.module ? [`   Module: ${node.module}`] : []),
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
