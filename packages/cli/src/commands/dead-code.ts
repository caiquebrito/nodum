import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { detectUnreachableFiles, findManifestEntryFiles, findCiInvokedFiles } from '@caiquebrito/nodum-core';

export interface DeadCodeOptions {
  json?: boolean;
  entry?: string;
}

function parsePatterns(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function deadCodeCommand(
  projectPath: string,
  nodumDataDir: string,
  options: DeadCodeOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const userEntryPatterns = options.entry ? parsePatterns(options.entry) : [];
  const manifestEntryFiles = await findManifestEntryFiles(resolve(projectPath), graph.nodes);
  const ciInvokedFiles = await findCiInvokedFiles(resolve(projectPath), graph.nodes);
  const entryPatterns = [...userEntryPatterns, ...manifestEntryFiles, ...ciInvokedFiles];
  const unreachable = detectUnreachableFiles(graph, {
    entryPatterns: entryPatterns.length > 0 ? entryPatterns : undefined,
  });

  if (options.json) {
    console.log(JSON.stringify(unreachable, null, 2));
    return;
  }

  if (unreachable.length === 0) {
    console.log('✅ No unreachable files found');
    return;
  }

  console.log(`🗑️  Unreachable files: ${unreachable.length} found (candidates for review, not definitive dead code)\n`);
  unreachable.forEach(f => console.log(`  - ${f.file}`));
}
