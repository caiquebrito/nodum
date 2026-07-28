#!/usr/bin/env node

import { Command } from 'commander';
import { homedir } from 'os';
import type { ProjectIndexEntry } from '@caiquebrito/nodum-core';
import { syncProject } from '../commands/sync.js';
import { getOwnVersion, printUpdateNoticeIfAny } from '../utils/update-notice.js';

const program = new Command();

function getNodeumDataDir(): string {
  const env = process.env.NODUM_DATA_DIR;
  if (env) return env;
  return `${homedir()}/.nodum`;
}

program
  .name('nodum')
  .description('Local knowledge graph for your code — scan projects, build interactive 3D graphs')
  .version(getOwnVersion());

program
  .command('init [projectPath]')
  .description('Interactive setup: sync + Claude Code integration')
  .action(async (projectPath: string | undefined) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { initProject } = await import('../commands/init.js');
      await initProject(projectPath || process.cwd(), nodumDataDir);
      await printUpdateNoticeIfAny(nodumDataDir);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('sync [projectPath]')
  .description('Scan and index a project, generate knowledge graph (defaults to current directory)')
  .option('--incremental', 'Only re-parse files changed since the last sync (falls back to a full sync if none exists)')
  .action(async (projectPath: string | undefined, options: { incremental?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const pathToSync = projectPath || process.cwd();
      await syncProject(pathToSync, nodumDataDir, { incremental: options.incremental });
      await printUpdateNoticeIfAny(nodumDataDir);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('config [projectPath]')
  .description('Show or update scan configuration (include/exclude patterns)')
  .option('--set-include <patterns>', 'Comma-separated patterns — only matching files are scanned')
  .option('--set-exclude <patterns>', 'Comma-separated patterns to exclude, in addition to .gitignore')
  .option('--set-architecture-rules <rules>', 'Comma-separated from:to group pairs to disallow importing (e.g. "ui:repo,model:service")')
  .action(async (
    projectPath: string | undefined,
    options: { setInclude?: string; setExclude?: string; setArchitectureRules?: string },
  ) => {
    try {
      const { showOrUpdateConfig } = await import('../commands/config.js');
      await showOrUpdateConfig(projectPath || process.cwd(), options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('architecture [projectPath]')
  .description('Detect imports that violate declared architecture rules')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--rule <rules>', 'Comma-separated from:to group pairs to disallow, in addition to any persisted in .nodumrc.json')
  .action(async (projectPath: string | undefined, options: { json?: boolean; rule?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { architectureCommand } = await import('../commands/architecture.js');
      await architectureCommand(projectPath || process.cwd(), nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('watch [projectPath]')
  .description('Watch a project and automatically sync on file changes (incremental)')
  .option('--debounce <ms>', 'Milliseconds to wait after a change before syncing', '500')
  .action(async (projectPath: string | undefined, options: { debounce: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { watchProject } = await import('../commands/watch.js');
      await watchProject(projectPath || process.cwd(), nodumDataDir, {
        debounceMs: parseInt(options.debounce, 10),
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('export [projectPath]')
  .description("Export a synced project's graph to JSON, GraphML, or CSV")
  .option('--format <format>', 'json | graphml | csv', 'json')
  .option('--output <path>', 'Output path (base path for csv, which writes two files)')
  .action(async (projectPath: string | undefined, options: { format: string; output?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { exportGraph } = await import('../commands/export.js');
      await exportGraph(projectPath || process.cwd(), nodumDataDir, {
        format: options.format as 'json' | 'graphml' | 'csv',
        output: options.output,
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('diff <a> <b>')
  .description('Compare two graph snapshots (file paths or synced project names)')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (a: string, b: string, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { diffCommand } = await import('../commands/diff.js');
      await diffCommand(a, b, nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('cycles [projectPath]')
  .description('Detect circular imports in a synced project')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (projectPath: string | undefined, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { cyclesCommand } = await import('../commands/cycles.js');
      await cyclesCommand(projectPath || process.cwd(), nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('dead-code [projectPath]')
  .description('Find files no other file imports — candidates for dead code')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--entry <patterns>', 'Comma-separated globs treated as entry points in addition to the built-in defaults')
  .action(async (projectPath: string | undefined, options: { json?: boolean; entry?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { deadCodeCommand } = await import('../commands/dead-code.js');
      await deadCodeCommand(projectPath || process.cwd(), nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('complexity [projectPath]')
  .description('Rank functions/methods by cyclomatic complexity')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--threshold <n>', 'Only show functions with complexity >= n')
  .action(async (projectPath: string | undefined, options: { json?: boolean; threshold?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { complexityCommand } = await import('../commands/complexity.js');
      await complexityCommand(projectPath || process.cwd(), nodumDataDir, {
        json: options.json,
        threshold: options.threshold ? parseInt(options.threshold, 10) : undefined,
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('duplicates [projectPath]')
  .description('Find structurally near-identical functions/methods')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (projectPath: string | undefined, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { duplicatesCommand } = await import('../commands/duplicates.js');
      await duplicatesCommand(projectPath || process.cwd(), nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('trace-impact <projectPath> <nodeId>')
  .description('Show every file transitively affected by changing a given node')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--max-depth <n>', 'Cap how many hops to report')
  .action(async (projectPath: string, nodeId: string, options: { json?: boolean; maxDepth?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { traceImpactCommand } = await import('../commands/trace-impact.js');
      await traceImpactCommand(projectPath, nodeId, nodumDataDir, {
        json: options.json,
        maxDepth: options.maxDepth ? parseInt(options.maxDepth, 10) : undefined,
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('bottlenecks [projectPath]')
  .description('Rank files by a composite bottleneck score (complexity x dependents)')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--limit <n>', 'Cap the number of results')
  .action(async (projectPath: string | undefined, options: { json?: boolean; limit?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { bottlenecksCommand } = await import('../commands/bottlenecks.js');
      await bottlenecksCommand(projectPath || process.cwd(), nodumDataDir, {
        json: options.json,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('explain-architecture [projectPath]')
  .description('Auto-generate an architecture overview: layers, dependencies between them, and any rule violations')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (projectPath: string | undefined, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { explainArchitectureCommand } = await import('../commands/explain-architecture.js');
      await explainArchitectureCommand(projectPath || process.cwd(), nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('similar-code <projectPath> <nodeId>')
  .description('Find other functions/methods structurally near-identical to a given node')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .action(async (projectPath: string, nodeId: string, options: { json?: boolean }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { similarCodeCommand } = await import('../commands/similar-code.js');
      await similarCodeCommand(projectPath, nodeId, nodumDataDir, options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('suggest-refactoring [projectPath]')
  .description('Unified refactoring suggestions: cycles, dead code, architecture violations, high complexity, duplication')
  .option('--json', 'Output machine-readable JSON instead of a formatted summary')
  .option('--complexity-threshold <n>', 'Override the default complexity threshold (10)')
  .action(async (projectPath: string | undefined, options: { json?: boolean; complexityThreshold?: string }) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { suggestRefactoringCommand } = await import('../commands/suggest-refactoring.js');
      await suggestRefactoringCommand(projectPath || process.cwd(), nodumDataDir, {
        json: options.json,
        complexityThreshold: options.complexityThreshold ? parseInt(options.complexityThreshold, 10) : undefined,
      });
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
