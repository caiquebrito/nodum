import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { findSimilarCode } from '@caiquebrito/nodum-core';

export interface SimilarCodeOptions {
  json?: boolean;
}

export async function similarCodeCommand(
  projectPath: string,
  nodeId: string,
  nodumDataDir: string,
  options: SimilarCodeOptions = {},
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
  const result = findSimilarCode(graph, nodeId);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const label = node?.label ?? nodeId;

  if (result.matches.length === 0) {
    console.log(`✅ No similar code found for ${label}`);
    return;
  }

  console.log(`🧬 Code similar to ${label}: ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'}\n`);
  result.matches.forEach(m => console.log(`  - ${m.label} (${m.file})`));
}
