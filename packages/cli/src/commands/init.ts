import { resolve, join } from 'path';
import { execSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import prompts from 'prompts';
import { syncProject as coreSyncProject } from '@caiquebrito/nodum-core';

export async function initProject(projectPath: string, nodumDataDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'nodum init is interactive and requires a terminal. Run `nodum sync` directly in non-interactive contexts (CI, piped input).',
    );
  }

  const absolutePath = resolve(projectPath);
  console.log(`🚀 Setting up nodum for ${absolutePath}\n`);

  const answers = await prompts([
    { type: 'confirm', name: 'runSync', message: 'Run the initial sync now?', initial: true },
    { type: 'confirm', name: 'setupMcp', message: 'Set up Claude Code integration (.mcp.json)?', initial: true },
  ]);

  if (answers.runSync) {
    const graph = await coreSyncProject(absolutePath, nodumDataDir);
    console.log(
      `✅ Synced: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n`,
    );
  }

  if (answers.setupMcp) {
    await writeMcpConfig(absolutePath);
  }

  console.log('\n🎉 Setup complete!\n');
  console.log('Next steps:');
  if (answers.setupMcp) {
    console.log('  • Restart Claude Code and run /mcp to confirm nodum is connected');
  }
  console.log('  • nodum watch — keep the graph updated automatically as you edit');
  console.log('  • nodum config — customize include/exclude scan patterns');
}

function resolveBinary(name: string): string | null {
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch {
    return null;
  }
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

async function writeMcpConfig(projectPath: string): Promise<void> {
  const mcpPath = join(projectPath, '.mcp.json');

  let config: McpConfig = {};
  try {
    config = JSON.parse(await readFile(mcpPath, 'utf-8'));
  } catch {
    // No existing .mcp.json — start fresh.
  }
  config.mcpServers ??= {};

  const nodeBin = resolveBinary('node');
  const nodumMcpBin = resolveBinary('nodum-mcp');

  config.mcpServers.nodum =
    nodeBin && nodumMcpBin ? { command: nodeBin, args: [nodumMcpBin] } : { command: 'nodum-mcp' };

  await writeFile(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(
    `✅ Wrote ${mcpPath}${nodeBin && nodumMcpBin ? ' (with absolute paths)' : ' (bare command — nodum-mcp must be on PATH)'}`,
  );
}
