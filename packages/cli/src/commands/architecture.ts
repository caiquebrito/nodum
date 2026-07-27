import { resolve, basename } from 'path';
import { readFile } from 'fs/promises';
import type { ArchitectureRule, Graph } from '@caiquebrito/nodum-core';
import { detectArchitectureViolations, loadArchitectureConfig } from '@caiquebrito/nodum-core';

export interface ArchitectureOptions {
  json?: boolean;
  rule?: string;
}

function parseRules(raw: string): ArchitectureRule[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [from, to] = pair.split(':').map(s => s.trim());
      return { from, to };
    });
}

export async function architectureCommand(
  projectPath: string,
  nodumDataDir: string,
  options: ArchitectureOptions = {},
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
  const cliRules = options.rule ? parseRules(options.rule) : [];
  const rules = [...(config.rules ?? []), ...cliRules];

  const violations = detectArchitectureViolations(graph, rules);

  if (options.json) {
    console.log(JSON.stringify(violations, null, 2));
    return;
  }

  if (violations.length === 0) {
    console.log('✅ No architecture violations found');
    return;
  }

  console.log(`🏛️  Architecture violations: ${violations.length} found\n`);
  violations.forEach((v, i) => {
    console.log(`  ${i + 1}. [${v.rule.from} → ${v.rule.to}] ${v.sourceFile} → ${v.targetFile}`);
  });
}
