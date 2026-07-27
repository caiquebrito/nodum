import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { traceImpact } from '@caiquebrito/nodum-core';

export interface TraceImpactOptions {
  json?: boolean;
  maxDepth?: number;
}

export async function traceImpactCommand(
  projectPath: string,
  nodeId: string,
  nodumDataDir: string,
  options: TraceImpactOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const impacted = traceImpact(graph, nodeId, { maxDepth: options.maxDepth });

  if (options.json) {
    console.log(JSON.stringify(impacted, null, 2));
    return;
  }

  if (impacted.length === 0) {
    console.log(`✅ No files depend on ${node.file ?? node.label}`);
    return;
  }

  console.log(`📡 Impact of changing ${node.file ?? node.label}: ${impacted.length} files\n`);

  const byDistance = new Map<number, typeof impacted>();
  for (const item of impacted) {
    if (!byDistance.has(item.distance)) byDistance.set(item.distance, []);
    byDistance.get(item.distance)!.push(item);
  }
  for (const [distance, items] of [...byDistance.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${distance} hop${distance === 1 ? '' : 's'}:`);
    items.forEach(item => console.log(`    - ${item.file}`));
  }
}
