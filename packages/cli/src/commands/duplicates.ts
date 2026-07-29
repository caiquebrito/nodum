import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { detectDuplicates, detectNearDuplicates } from '@caiquebrito/nodum-core';

export interface DuplicatesOptions {
  json?: boolean;
  /** Group near-duplicates (MinHash-estimated fuzzy similarity, spec 052) instead of exact duplicateHash matches. */
  fuzzy?: boolean;
  threshold?: number;
  limit?: number;
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

  if (options.fuzzy) {
    const result = detectNearDuplicates(graph, { threshold: options.threshold, limit: options.limit });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.groups.length === 0) {
      console.log(`✅ No near-duplicate groups found (threshold ${result.threshold})`);
      return;
    }

    console.log(`🧬 Near-duplicate groups: ${result.groups.length} found (threshold ${result.threshold})\n`);
    result.groups.forEach((group, i) => {
      const avgPct = Math.round(group.avgSimilarity * 100);
      console.log(`  Group ${i + 1} (${group.nodes.length} functions, avg ${avgPct}% similar):`);
      group.nodes.forEach(n => console.log(`    - ${n.label} (${n.file})`));
    });
    if (result.truncated) {
      console.log(`\n  ... more groups exist beyond the limit; pass --limit to see more`);
    }
    return;
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
