import { resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { generateGraph } from './graph-gen.js';
import { analyzeProject } from './analyzer/index.js';
import { injectCLAUDEContext, appendActivityLog, buildAndWriteSummary } from './memory/index.js';

export async function syncProject(projectPath: string, nodumDataDir: string): Promise<void> {
  const absolutePath = resolve(projectPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Project path does not exist: ${absolutePath}`);
  }

  // 1. Generate graph
  const graph = await generateGraph(absolutePath);

  // 2. Analyze project
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
  await writeFile(
    `${graphDir}/graph.json`,
    JSON.stringify(graph, null, 2),
    'utf-8',
  );

  // 5. Build and write SUMMARY.md
  await buildAndWriteSummary(memoryDir, graph, analysis);

  // 6. Log activity
  await appendActivityLog(logsDir, graph);

  // 7. Inject CLAUDE.md
  await injectCLAUDEContext(absolutePath, graph, analysis);

  // 8. Update projects.json index
  await updateProjectIndex(nodumDataDir, graph, analysis);

  return;
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
