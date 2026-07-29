import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { rankByComplexity } from '@caiquebrito/nodum-core';

export interface ComplexityOptions {
  json?: boolean;
  threshold?: number;
  cognitive?: boolean;
}

export async function complexityCommand(
  projectPath: string,
  nodumDataDir: string,
  options: ComplexityOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const metric = options.cognitive ? 'cognitive' : 'cyclomatic';
  const ranking = rankByComplexity(graph, { threshold: options.threshold, metric });

  if (options.json) {
    console.log(JSON.stringify(ranking, null, 2));
    return;
  }

  if (ranking.length === 0) {
    console.log('✅ No scored functions found');
    return;
  }

  console.log(`🧮 Complexity ranking (${metric})\n`);
  ranking.forEach(r => {
    console.log(`  ${String(r.complexity).padStart(3)}  ${r.label} (${r.file})`);
  });
}
