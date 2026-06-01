/**
 * Generate embeddings for graph nodes
 * Uses Anthropic's text-embedding-3-small model
 * Cost: ~$0.001 per 1000 nodes (one-time per sync)
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const BATCH_SIZE = 100; // Process embeddings in batches

interface Node {
  id: string;
  label: string;
  type: string;
  file: string;
  group: string;
  embedding?: number[];
  clusterId?: string;
}

/**
 * Generate embedding for a node's text
 */
async function generateNodeEmbedding(node: Node): Promise<number[]> {
  // Embed: label + type (concise, captures semantic meaning)
  const text = `${node.label} ${node.type}`;

  try {
    const response = await (client as any).embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 256, // Use 256 dims instead of 1536 for smaller storage
    });

    return response.data[0].embedding;
  } catch (error) {
    console.warn(`Failed to embed node ${node.id}:`, error);
    return [];
  }
}

/**
 * Generate embeddings for all nodes in a graph
 * Batches requests to manage API rate limits
 */
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
      const response = await (client as any).embeddings.create({
        model: "text-embedding-3-small",
        input: query,
        dimensions: 256,
      });
      embeddings.push(response.data[0].embedding);
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
    const response = await (client as any).embeddings.create({
      model: "text-embedding-3-small",
      input: query,
      dimensions: 256,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.warn(`Failed to embed query "${query}":`, error);
    return [];
  }
}
