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

export async function syncProject(projectPath: string, nodumDataDir: string): Promise<void> {
  const absolutePath = resolve(projectPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Project path does not exist: ${absolutePath}`);
  }

  console.log(`📊 Scanning: ${absolutePath}`);

  try {
    // 1. Generate graph
    console.log('  → Parsing code...');
    const graph = await generateGraph(absolutePath);

    // 2. Analyze project
    console.log('  → Detecting stack...');
    const analysis = await analyzeProject(absolutePath);

    // 3. Create project data directory
    const projectDataDir = `${nodumDataDir}/${graph.project}`;
    const graphDir = `${projectDataDir}/graph`;
    const memoryDir = `${projectDataDir}/memory`;
    const logsDir = `${projectDataDir}/logs`;

    await mkdir(graphDir, { recursive: true });
    await mkdir(memoryDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });

    // 4. Write graph.json
    console.log('  → Writing graph.json...');
    const graphPath = `${graphDir}/graph.json`;
    await writeFile(
      graphPath,
      JSON.stringify(graph, null, 2),
      'utf-8',
    );

    // 4.5. v2.0: Generate clusters for hierarchical compression
    console.log('  → Generating clusters...');
    const { clusters, nodeToCluster } = buildClusters(graph.nodes, graph.edges);

    // Update graph with clusters
    const graphWithClusters = {
      ...graph,
      clusters,
      nodeToCluster: Object.fromEntries(nodeToCluster),
    };

    // Write updated graph with clusters
    await writeFile(
      graphPath,
      JSON.stringify(graphWithClusters, null, 2),
      'utf-8',
    );

    // 5. Build and write SUMMARY.md
    console.log('  → Generating SUMMARY.md...');
    await buildAndWriteSummary(memoryDir, graph, analysis);

    // 6. Log activity
    console.log('  → Logging activity...');
    await appendActivityLog(logsDir, graph);

    // 7. Inject CLAUDE.md
    console.log('  → Injecting CLAUDE.md context...');
    await injectCLAUDEContext(absolutePath, graph, analysis);

    // 8. Update projects.json index
    console.log('  → Updating projects index...');
    await updateProjectIndex(nodumDataDir, graph, analysis);

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
