import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { loadScanConfig, saveScanConfig, getAvailableParsers, type ScanConfig } from '@caiquebrito/nodum-core';

export interface ConfigOptions {
  setInclude?: string;
  setExclude?: string;
}

function parsePatterns(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
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

  const config = await loadScanConfig(target);
  const hasGitignore = existsSync(join(target, '.gitignore'));
  const extensions = [...new Set(getAvailableParsers().flatMap(p => p.extensions))].sort();

  console.log(`\n📋 Scan configuration for ${target}\n`);
  console.log(`  .gitignore honored: ${hasGitignore ? 'yes' : 'no (.gitignore not found)'}`);
  console.log(`  Include patterns: ${config.include?.join(', ') || '(none — scanning everything not excluded)'}`);
  console.log(`  Exclude patterns: ${config.exclude?.join(', ') || '(none beyond .gitignore + built-in defaults)'}`);
  console.log(`  Supported extensions: ${extensions.join(', ')}`);
}
