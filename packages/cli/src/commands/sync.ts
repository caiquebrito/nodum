import { resolve } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  generateGraph,
  analyzeProject,
  injectCLAUDEContext,
  appendActivityLog,
  buildAndWriteSummary,
  buildClusters,
} from '@caiquebrito/nodum-core';
import { makeProgressBar, runStep } from '../utils/progress.js';

export async function syncProject(projectPath: string, nodumDataDir: string): Promise<void> {
  const absolutePath = resolve(projectPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Project path does not exist: ${absolutePath}`);
  }

  console.log(`📊 Scanning: ${absolutePath}`);

  try {
    // 1. Generate graph (real per-file progress)
    const parseBar = makeProgressBar('Parsing code');
    const graph = await generateGraph(absolutePath, (processed, total) =>
      parseBar.update(processed, total),
    );
    parseBar.done();

    // 2. Analyze project
    const analysis = await runStep('Detecting stack', () =>
      analyzeProject(absolutePath),
    );

    // 3. Create project data directory
    const projectDataDir = `${nodumDataDir}/${graph.project}`;
    const graphDir = `${projectDataDir}/graph`;
    const memoryDir = `${projectDataDir}/memory`;
    const logsDir = `${projectDataDir}/logs`;

    await mkdir(graphDir, { recursive: true });
    await mkdir(memoryDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });

    // 4. Write graph.json
    const graphPath = `${graphDir}/graph.json`;
    await runStep('Writing graph.json', () =>
      writeFile(graphPath, JSON.stringify(graph, null, 2), 'utf-8'),
    );

    // 4.5. v2.0: Generate clusters for hierarchical compression
    const clusterBar = makeProgressBar('Generating clusters');
    const { clusters, nodeToCluster } = buildClusters(
      graph.nodes,
      graph.edges,
      (processed, total) => clusterBar.update(processed, total),
    );
    clusterBar.done();

    // Update graph with clusters
    const graphWithClusters = {
      ...graph,
      clusters,
      nodeToCluster: Object.fromEntries(nodeToCluster),
    };

    // Write updated graph with clusters
    await runStep('Writing clusters', () =>
      writeFile(graphPath, JSON.stringify(graphWithClusters, null, 2), 'utf-8'),
    );

    // 5. Build and write SUMMARY.md
    await runStep('Generating SUMMARY.md', () =>
      buildAndWriteSummary(memoryDir, graph, analysis),
    );

    // 6. Log activity
    await runStep('Logging activity', () => appendActivityLog(logsDir, graph));

    // 7. Inject CLAUDE.md
    await runStep('Injecting CLAUDE.md context', () =>
      injectCLAUDEContext(absolutePath, graph, analysis),
    );

    // 8. Update projects.json index
    await runStep('Updating projects index', () =>
      updateProjectIndex(nodumDataDir, graph, analysis),
    );

    // Done
    console.log(`\n✅ Synced: ${graph.project}`);
    console.log(`  📁 ${graph.stats.files} files`);
    console.log(`  ⚙️  ${graph.stats.functions} functions`);
    console.log(`  📦 ${graph.stats.classes} classes`);
    console.log(`  🔗 ${graph.stats.edges} dependencies\n`);
    console.log(`Data saved to: ${projectDataDir}`);
  } catch (error) {
    throw new Error(`Failed to sync project: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function updateProjectIndex(
  nodumDataDir: string,
  graph: any,
  analysis: any,
): Promise<void> {
  const projectsPath = `${nodumDataDir}/projects.json`;

  let projects: Record<string, any> = {};

  try {
    // Try to read existing projects.json
    const fs = await import('fs/promises');
    const content = await fs.readFile(projectsPath, 'utf-8');
    projects = JSON.parse(content);
  } catch {
    // File doesn't exist yet, that's ok
  }

  // Update or add this project
  projects[graph.project] = {
    name: graph.project,
    path: `${nodumDataDir}/${graph.project}`,
    lastSync: new Date().toISOString(),
    stats: graph.stats,
    stack: {
      languages: analysis.languages,
      frameworks: analysis.frameworks,
    },
  };

  // Write updated projects.json
  await writeFile(
    projectsPath,
    JSON.stringify(projects, null, 2),
    'utf-8',
  );
}
