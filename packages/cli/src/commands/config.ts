import { resolve, join } from 'path';
import { existsSync } from 'fs';
import {
  loadScanConfig,
  saveScanConfig,
  getAvailableParsers,
  loadArchitectureConfig,
  saveArchitectureConfig,
  type ScanConfig,
  type ArchitectureRule,
} from '@caiquebrito/nodum-core';

export interface ConfigOptions {
  setInclude?: string;
  setExclude?: string;
  setArchitectureRules?: string;
}

function parsePatterns(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
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

export async function showOrUpdateConfig(projectPath: string, options: ConfigOptions): Promise<void> {
  const target = resolve(projectPath);

  if (options.setInclude || options.setExclude) {
    const update: ScanConfig = {};
    if (options.setInclude) update.include = parsePatterns(options.setInclude);
    if (options.setExclude) update.exclude = parsePatterns(options.setExclude);
    await saveScanConfig(target, update);
    console.log(`✅ Updated ${target}/.nodumrc.json`);
  }

  if (options.setArchitectureRules) {
    await saveArchitectureConfig(target, { rules: parseRules(options.setArchitectureRules) });
    console.log(`✅ Updated ${target}/.nodumrc.json`);
  }

  const config = await loadScanConfig(target);
  const architectureConfig = await loadArchitectureConfig(target);
  const hasGitignore = existsSync(join(target, '.gitignore'));
  const extensions = [...new Set(getAvailableParsers().flatMap(p => p.extensions))].sort();

  console.log(`\n📋 Scan configuration for ${target}\n`);
  console.log(`  .gitignore honored: ${hasGitignore ? 'yes' : 'no (.gitignore not found)'}`);
  console.log(`  Include patterns: ${config.include?.join(', ') || '(none — scanning everything not excluded)'}`);
  console.log(`  Exclude patterns: ${config.exclude?.join(', ') || '(none beyond .gitignore + built-in defaults)'}`);
  console.log(`  Supported extensions: ${extensions.join(', ')}`);
  console.log(
    `  Architecture rules: ${architectureConfig.rules?.map(r => `${r.from}→${r.to}`).join(', ') || '(none)'}`,
  );
}
