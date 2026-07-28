import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { suggestRefactoring, loadArchitectureConfig } from '@caiquebrito/nodum-core';

export interface SuggestRefactoringOptions {
  json?: boolean;
  complexityThreshold?: number;
}

export async function suggestRefactoringCommand(
  projectPath: string,
  nodumDataDir: string,
  options: SuggestRefactoringOptions = {},
): Promise<void> {
  const target = resolve(projectPath);
  const projectName = basename(target);
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  const config = await loadArchitectureConfig(target);
  const architectureRules = config.rules?.length ? config.rules : undefined;

  const suggestions = suggestRefactoring(graph, {
    architectureRules,
    complexityThreshold: options.complexityThreshold,
  });

  if (options.json) {
    console.log(JSON.stringify(suggestions, null, 2));
    return;
  }

  if (suggestions.length === 0) {
    console.log('✅ No refactoring suggestions');
    return;
  }

  console.log(`🛠️  Refactoring suggestions (${suggestions.length})\n`);

  const byKind = new Map<string, typeof suggestions>();
  for (const s of suggestions) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, []);
    byKind.get(s.kind)!.push(s);
  }
  for (const [kind, items] of byKind) {
    console.log(`${kind.toUpperCase()} (${items.length}):`);
    items.forEach(s => console.log(`  - ${s.description} (${s.files.join(', ')})`));
    console.log('');
  }
}
