import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { explainArchitecture, loadArchitectureConfig } from '@caiquebrito/nodum-core';

export interface ExplainArchitectureOptions {
  json?: boolean;
}

export async function explainArchitectureCommand(
  projectPath: string,
  nodumDataDir: string,
  options: ExplainArchitectureOptions = {},
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
  const rules = config.rules?.length ? config.rules : undefined;

  const summary = explainArchitecture(graph, rules);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('🏛️  Architecture overview\n');
  console.log('Layers:');
  summary.layers.forEach(layer => {
    console.log(`  ${layer.group}  ${layer.fileCount} files, ${layer.nodeCount} nodes`);
  });

  console.log('\nDependencies between layers:');
  if (summary.layerDependencies.length === 0) {
    console.log('  (none)');
  } else {
    summary.layerDependencies.forEach(dep => {
      console.log(`  ${dep.sourceGroup} → ${dep.targetGroup}  ${dep.importCount} imports`);
    });
  }

  console.log('');
  if (summary.violations === undefined) {
    console.log('Architecture rules: (none configured — run `nodum config --set-architecture-rules` to add some)');
  } else {
    console.log(`Architecture rules: ${rules!.length} configured`);
    console.log(`Violations: ${summary.violations.length} found`);
    summary.violations.forEach(v => {
      console.log(`  [${v.rule.from} → ${v.rule.to}] ${v.sourceFile} → ${v.targetFile}`);
    });
  }
}
