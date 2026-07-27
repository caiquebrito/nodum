import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { detectCycles } from '@caiquebrito/nodum-core';

export interface CyclesOptions {
  json?: boolean;
}

export async function cyclesCommand(
  projectPath: string,
  nodumDataDir: string,
  options: CyclesOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const cycles = detectCycles(graph);

  if (options.json) {
    console.log(JSON.stringify(cycles, null, 2));
    return;
  }

  if (cycles.length === 0) {
    console.log('✅ No circular imports found');
    return;
  }

  console.log(`🔁 Dependency cycles: ${cycles.length} found\n`);
  cycles.forEach((cycle, i) => {
    const chain = [...cycle.files, cycle.files[0]].join(' → ');
    const label = cycle.files.length === 1 ? ' (self-import)' : '';
    console.log(`  ${i + 1}. ${chain}${label}`);
  });
}
