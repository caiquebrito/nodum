/**
 * Generate embeddings for graph nodes
 * Uses a local sentence-embedding model (Xenova/all-MiniLM-L6-v2, 384-dim) via
 * @xenova/transformers — runs in-process (WASM/JS), no API key, no cloud calls.
 * The model is downloaded once on first use and cached locally; every call
 * after that is fully offline.
 */

import { pipeline } from "@xenova/transformers";
import type { Graph, Node } from "@caiquebrito/nodum-core";
import { tokenizeIdentifier } from "./identifier-tokenize.js";

type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array }>;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * Format version of the text `generateNodeEmbedding` builds each node's
 * embedding from (spec 067). Bump whenever `buildNodeEmbeddingText` changes
 * in a way that makes old and new embeddings incomparable — cosine
 * similarity across differently-sourced embeddings is meaningless, not just
 * "a bit off". Stored on `Graph.embeddingVersion`; `hasEmbeddings()` treats
 * a missing/mismatched version as unembedded so a stale graph regenerates
 * rather than silently mixing generations with freshly-embedded queries.
 */
export const EMBEDDING_TEXT_VERSION = 1;

/** Cap on how many outgoing/incoming edge target labels are folded into a
 * node's embedding text — enough to give real semantic signal without
 * ballooning the text with every fan-out/fan-in neighbor of a hub node. */
const MAX_RELATED_LABELS = 5;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID) as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

/**
 * Embed a single string using the local model
 */
async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/**
 * Outgoing/incoming edge target-node labels per node id, built once (O(edges))
 * from `Graph.edges` — same adjacency-map-once technique `expandContext` uses
 * in `smart-context.ts`, applied here so `generateGraphEmbeddings` doesn't
 * rescan every edge per node (O(nodes × edges)).
 */
export interface AdjacencyLabels {
  outgoingByNode: Map<string, string[]>;
  incomingByNode: Map<string, string[]>;
}

export function buildAdjacencyLabels(graph: Pick<Graph, "nodes" | "edges">): AdjacencyLabels {
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const outgoingByNode = new Map<string, string[]>();
  const incomingByNode = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    if (targetNode) {
      if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
      outgoingByNode.get(edge.source)!.push(targetNode.label);
    }
    if (sourceNode) {
      if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
      incomingByNode.get(edge.target)!.push(sourceNode.label);
    }
  }

  return { outgoingByNode, incomingByNode };
}

/**
 * Build the structured text a node's embedding is generated from (spec 067).
 * Exported (and kept pure/synchronous) so it can be unit-tested directly
 * without invoking the real embedding model.
 *
 * Format:
 * ```
 * <split label> — <type> in <file basename>
 * module: <module> · layer: <group> · sourceSet: <sourceSet>   (only set fields)
 * calls: <up to 5 outgoing edge target labels>
 * used by: <up to 5 incoming edge source labels>
 * ```
 *
 * The label is split on identifier boundaries (`authenticateUser` ->
 * `authenticate user`) via the shared `tokenizeIdentifier` (spec 068) —
 * MiniLM's tokenizer is trained on natural language, not camelCase, so
 * splitting gives it words it has good representations for.
 */
export function buildNodeEmbeddingText(node: Node, adjacency: AdjacencyLabels): string {
  const splitLabel = tokenizeIdentifier(node.label).join(" ") || node.label;
  const fileBasename = node.file.split(/[\\/]/).pop() || node.file;

  const lines: string[] = [`${splitLabel} — ${node.type} in ${fileBasename}`];

  const metaParts: string[] = [];
  if (node.module) metaParts.push(`module: ${node.module}`);
  if (node.group) metaParts.push(`layer: ${node.group}`);
  if (node.sourceSet) metaParts.push(`sourceSet: ${node.sourceSet}`);
  if (metaParts.length > 0) lines.push(metaParts.join(" · "));

  const calls = (adjacency.outgoingByNode.get(node.id) ?? []).slice(0, MAX_RELATED_LABELS);
  if (calls.length > 0) lines.push(`calls: ${calls.join(", ")}`);

  const usedBy = (adjacency.incomingByNode.get(node.id) ?? []).slice(0, MAX_RELATED_LABELS);
  if (usedBy.length > 0) lines.push(`used by: ${usedBy.join(", ")}`);

  return lines.join("\n");
}

/**
 * Generate embedding for a node's text
 */
async function generateNodeEmbedding(node: Node, adjacency: AdjacencyLabels): Promise<number[]> {
  const text = buildNodeEmbeddingText(node, adjacency);

  try {
    return await embed(text);
  } catch (error) {
    console.warn(`Failed to embed node ${node.id}:`, error);
    return [];
  }
}

/**
 * Generate embeddings for all nodes in a graph
 * Batches requests to manage memory usage
 */
const BATCH_SIZE = 100; // Process embeddings in batches

export async function generateGraphEmbeddings(graph: Graph): Promise<void> {
  // A version mismatch (or missing version, e.g. a pre-067 graph.json) means
  // every existing `embedding` was built from the old "<label> <type>" text —
  // treat all non-file nodes as needing re-embedding rather than trusting
  // stale vectors just because `n.embedding` happens to be set.
  const staleVersion = graph.embeddingVersion !== EMBEDDING_TEXT_VERSION;

  const nodesToEmbed = graph.nodes.filter(
    n => n.type !== "file" && (staleVersion || !n.embedding)
  );

  if (nodesToEmbed.length === 0) {
    console.log("ℹ️ All nodes already have embeddings, skipping generation");
    graph.embeddingVersion = EMBEDDING_TEXT_VERSION;
    return;
  }

  console.log(`🔄 Generating embeddings for ${nodesToEmbed.length} nodes...`);

  const adjacency = buildAdjacencyLabels(graph);

  // Process in batches
  for (let i = 0; i < nodesToEmbed.length; i += BATCH_SIZE) {
    const batch = nodesToEmbed.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(nodesToEmbed.length / BATCH_SIZE);

    console.log(`  Batch ${batchNumber}/${totalBatches}...`);

    // Generate embeddings for this batch
    const embeddings = await Promise.all(
      batch.map(node => generateNodeEmbedding(node, adjacency))
    );

    // Assign embeddings to nodes
    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = embeddings[j];
    }
  }

  graph.embeddingVersion = EMBEDDING_TEXT_VERSION;

  console.log(`✅ Generated embeddings for ${nodesToEmbed.length} nodes`);
}

/**
 * Check if a (sub)set of nodes has usable embeddings for semantic search.
 *
 * `embeddingVersion` should be the owning `Graph`'s `embeddingVersion` — a
 * mismatch (or `undefined`, e.g. a pre-067 graph.json) means whatever
 * `embedding` arrays are present were built from stale text and are not
 * comparable to a freshly-embedded query, so they're treated as absent
 * entirely rather than fed into cosine similarity.
 */
export function hasEmbeddings(nodes: Node[], embeddingVersion?: number): boolean {
  if (embeddingVersion !== EMBEDDING_TEXT_VERSION) return false;

  // Check if at least 50% of non-file nodes have embeddings
  const nonFileNodes = nodes.filter(n => n.type !== "file");
  if (nonFileNodes.length === 0) return false; // vacuously true otherwise (0 >= 0)
  const withEmbeddings = nonFileNodes.filter(n => n.embedding && n.embedding.length > 0);
  return withEmbeddings.length >= nonFileNodes.length * 0.5;
}

/**
 * Generate embeddings for a list of queries
 */
export async function generateQueryEmbeddings(
  queries: string[]
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (const query of queries) {
    try {
      embeddings.push(await embed(query));
    } catch (error) {
      console.warn(`Failed to embed query "${query}":`, error);
      embeddings.push([]);
    }
  }

  return embeddings;
}

/**
 * Generate single query embedding
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  try {
    return await embed(query);
  } catch (error) {
    console.warn(`Failed to embed query "${query}":`, error);
    return [];
  }
}
