import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { findBottlenecks } from '@caiquebrito/nodum-core';

export interface BottlenecksOptions {
  json?: boolean;
  limit?: number;
}

export async function bottlenecksCommand(
  projectPath: string,
  nodumDataDir: string,
  options: BottlenecksOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const bottlenecks = findBottlenecks(graph, { limit: options.limit });

  if (options.json) {
    console.log(JSON.stringify(bottlenecks, null, 2));
    return;
  }

  if (bottlenecks.length === 0) {
    console.log('✅ No scored functions found');
    return;
  }

  console.log(`🔥 Bottlenecks (${bottlenecks.length})\n`);
  bottlenecks.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.file}  score=${b.score}  complexity=${b.maxComplexity}  dependents=${b.dependentCount}`);
  });
}
