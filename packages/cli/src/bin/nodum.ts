#!/usr/bin/env node

import { Command } from 'commander';
import { homedir } from 'os';
import type { ProjectIndexEntry } from '@caiquebrito/nodum-core';
import { syncProject } from '../commands/sync.js';

const program = new Command();

function getNodeumDataDir(): string {
  const env = process.env.NODUM_DATA_DIR;
  if (env) return env;
  return `${homedir()}/.nodum`;
}

program
  .name('nodum')
  .description('Local knowledge graph for your code — scan projects, build interactive 3D graphs')
  .version('1.0.0');

program
  .command('sync [projectPath]')
  .description('Scan and index a project, generate knowledge graph (defaults to current directory)')
  .option('--incremental', 'Only re-parse files changed since the last sync (falls back to a full sync if none exists)')
  .action(async (projectPath: string | undefined, options: { incremental?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const pathToSync = projectPath || process.cwd();
      await syncProject(pathToSync, nodumDataDir, { incremental: options.incremental });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show all synced projects')
  .action(async () => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const fs = await import('fs/promises');

      try {
        const content = await fs.readFile(`${nodumDataDir}/projects.json`, 'utf-8');
        const projects: Record<string, ProjectIndexEntry> = JSON.parse(content);
        const projectList = Object.values(projects);

        if (projectList.length === 0) {
          console.log('No projects synced yet. Run: nodum sync (or nodum sync /path/to/project)');
          return;
        }

        console.log('\n📊 Synced Projects:\n');
        for (const project of projectList) {
          console.log(`  📦 ${project.name}`);
          console.log(`     Files: ${project.stats.files} | Functions: ${project.stats.functions} | Classes: ${project.stats.classes}`);
          console.log(`     Stack: ${project.stack.languages.join(', ') || 'unknown'}\n`);
        }
      } catch {
        console.log('No projects synced yet. Run: nodum sync (or nodum sync /path/to/project)');
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start 3D visualizer server on localhost:7842')
  .action(async () => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { startServer } = await import('../commands/serve.js');
      await startServer(nodumDataDir);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse(process.argv);
