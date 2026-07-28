/**
 * Generate embeddings for graph nodes
 * Uses a local sentence-embedding model (Xenova/all-MiniLM-L6-v2, 384-dim) via
 * @xenova/transformers — runs in-process (WASM/JS), no API key, no cloud calls.
 * The model is downloaded once on first use and cached locally; every call
 * after that is fully offline.
 */

import { pipeline } from "@xenova/transformers";
import type { Node } from "@caiquebrito/nodum-core";

type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array }>;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

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
 * Generate embedding for a node's text
 */
async function generateNodeEmbedding(node: Node): Promise<number[]> {
  // Embed: label + type (concise, captures semantic meaning)
  const text = `${node.label} ${node.type}`;

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

export async function generateGraphEmbeddings(nodes: Node[]): Promise<void> {
  const nodesToEmbed = nodes.filter(n => !n.embedding && n.type !== "file");

  if (nodesToEmbed.length === 0) {
    console.log("ℹ️ All nodes already have embeddings, skipping generation");
    return;
  }

  console.log(`🔄 Generating embeddings for ${nodesToEmbed.length} nodes...`);

  // Process in batches
  for (let i = 0; i < nodesToEmbed.length; i += BATCH_SIZE) {
    const batch = nodesToEmbed.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(nodesToEmbed.length / BATCH_SIZE);

    console.log(`  Batch ${batchNumber}/${totalBatches}...`);

    // Generate embeddings for this batch
    const embeddings = await Promise.all(
      batch.map(node => generateNodeEmbedding(node))
    );

    // Assign embeddings to nodes
    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = embeddings[j];
    }
  }

  console.log(`✅ Generated embeddings for ${nodesToEmbed.length} nodes`);
}

/**
 * Check if a graph has embeddings (for version compatibility)
 */
export function hasEmbeddings(nodes: Node[]): boolean {
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
