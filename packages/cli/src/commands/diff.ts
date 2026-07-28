import { resolve, basename } from 'path';
import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { diffGraphs } from '@caiquebrito/nodum-core';

async function resolveGraph(arg: string, nodumDataDir: string): Promise<Graph> {
  const absolute = resolve(arg);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    return JSON.parse(await readFile(absolute, 'utf-8'));
  }

  const projectName = basename(absolute);
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;
  try {
    return JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(
      `Could not resolve "${arg}" as a file or a synced project. Run \`nodum sync\` first, or pass a graph.json path.`,
    );
  }
}

export interface DiffOptions {
  json?: boolean;
}

export async function diffCommand(
  a: string,
  b: string,
  nodumDataDir: string,
  options: DiffOptions = {},
): Promise<void> {
  const [graphA, graphB] = await Promise.all([resolveGraph(a, nodumDataDir), resolveGraph(b, nodumDataDir)]);
  const diff = diffGraphs(graphA, graphB);

  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(`📊 Graph diff: ${a} → ${b}\n`);

  console.log('Stats:');
  for (const [key, delta] of Object.entries(diff.statsDelta)) {
    const sign = delta > 0 ? '+' : '';
    const before = (graphA.stats as Record<string, number>)[key];
    const after = (graphB.stats as Record<string, number>)[key];
    console.log(`  ${key.padEnd(11)} ${before} → ${after}  (${sign}${delta})`);
  }

  console.log(`\n+ Added nodes (${diff.nodes.added.length})`);
  diff.nodes.added.forEach(n => console.log(`  + ${n.label} (${n.type}) in ${n.file}`));

  console.log(`\n- Removed nodes (${diff.nodes.removed.length})`);
  diff.nodes.removed.forEach(n => console.log(`  - ${n.label} (${n.type}) in ${n.file}`));

  console.log(`\n~ Changed nodes (${diff.nodes.changed.length})`);
  diff.nodes.changed.forEach(c =>
    console.log(
      `  ~ ${c.before.label}: ${c.changedFields.map(f => `${f} "${c.before[f]}" → "${c.after[f]}"`).join(', ')}`,
    ),
  );

  console.log(`\n+ Added edges (${diff.edges.added.length})`);
  console.log(`- Removed edges (${diff.edges.removed.length})`);
}
