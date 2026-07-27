import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { detectDuplicates } from '@caiquebrito/nodum-core';

export interface DuplicatesOptions {
  json?: boolean;
}

export async function duplicatesCommand(
  projectPath: string,
  nodumDataDir: string,
  options: DuplicatesOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const groups = detectDuplicates(graph);

  if (options.json) {
    console.log(JSON.stringify(groups, null, 2));
    return;
  }

  if (groups.length === 0) {
    console.log('✅ No duplicate groups found');
    return;
  }

  console.log(`🧬 Duplicate groups: ${groups.length} found\n`);
  groups.forEach((group, i) => {
    console.log(`  Group ${i + 1} (${group.nodes.length} functions):`);
    group.nodes.forEach(n => console.log(`    - ${n.label} (${n.file})`));
  });
}
