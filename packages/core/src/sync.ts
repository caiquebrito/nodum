import { resolve } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { generateGraph } from './graph-gen.js';
import { analyzeProject } from './analyzer/index.js';
import { buildClusters } from './analyzer/clustering.js';
import { injectCLAUDEContext, appendActivityLog, buildAndWriteSummary } from './memory/index.js';
import type { Graph, ProjectAnalysis, ProjectIndexEntry } from './types.js';

export interface SyncHooks {
  /** Fired repeatedly while parsing files. */
  onParseProgress?: (processed: number, total: number) => void;
  /** Fired repeatedly while building clusters. */
  onClusterProgress?: (processed: number, total: number) => void;
  /** Fired once before each atomic step (analyze, write summary, etc). */
  onStep?: (label: string) => void;
}

function graphDataDir(nodumDataDir: string, projectName: string): string {
  return `${nodumDataDir}/${projectName}`;
}

function graphFilePath(nodumDataDir: string, projectName: string): string {
  return `${graphDataDir(nodumDataDir, projectName)}/graph/graph.json`;
}

/**
 * Single canonical sync pipeline: discover, parse, analyze, cluster, and
 * persist a project's knowledge graph. Always clusters — callers that need
 * additional post-processing (e.g. embeddings) should mutate the returned
 * Graph and persist it with writeGraphFile().
 */
export async function syncProject(
  projectPath: string,
  nodumDataDir: string,
  hooks: SyncHooks = {},
): Promise<Graph> {
  const absolutePath = resolve(projectPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Project path does not exist: ${absolutePath}`);
  }

  // 1. Generate graph
  const graph = await generateGraph(absolutePath, hooks.onParseProgress);

  // 2. Analyze project
  hooks.onStep?.('Detecting stack');
  const analysis = await analyzeProject(absolutePath);

  // 3. Cluster nodes for hierarchical compression
  const { clusters, nodeToCluster } = buildClusters(
    graph.nodes,
    graph.edges,
    hooks.onClusterProgress,
  );
  graph.clusters = clusters;
  graph.nodeToCluster = Object.fromEntries(nodeToCluster);

  // 4. Create project data directory
  const projectDataDir = graphDataDir(nodumDataDir, graph.project);
  const graphDir = `${projectDataDir}/graph`;
  const memoryDir = `${projectDataDir}/memory`;
  const logsDir = `${projectDataDir}/logs`;

  await mkdir(graphDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  // 5. Write graph.json (once — already includes clusters)
  hooks.onStep?.('Writing graph.json');
  await writeFile(
    `${graphDir}/graph.json`,
    JSON.stringify(graph, null, 2),
    'utf-8',
  );

  // 6. Build and write SUMMARY.md
  hooks.onStep?.('Generating SUMMARY.md');
  await buildAndWriteSummary(memoryDir, graph, analysis);

  // 7. Log activity
  hooks.onStep?.('Logging activity');
  await appendActivityLog(logsDir, graph);

  // 8. Inject CLAUDE.md
  hooks.onStep?.('Injecting CLAUDE.md context');
  await injectCLAUDEContext(absolutePath, graph, analysis);

  // 9. Update projects.json index
  hooks.onStep?.('Updating projects index');
  await updateProjectIndex(nodumDataDir, graph, analysis);

  return graph;
}

/**
 * Persist a mutated Graph back to disk at its existing sync location.
 * For callers (e.g. the MCP server) that post-process the graph returned
 * by syncProject() — generating embeddings, for example — and need to
 * write the result without re-deriving the file path themselves.
 */
export async function writeGraphFile(
  nodumDataDir: string,
  projectName: string,
  graph: Graph,
): Promise<void> {
  await writeFile(
    graphFilePath(nodumDataDir, projectName),
    JSON.stringify(graph, null, 2),
    'utf-8',
  );
}

async function updateProjectIndex(
  nodumDataDir: string,
  graph: Graph,
  analysis: ProjectAnalysis,
): Promise<void> {
  const projectsPath = `${nodumDataDir}/projects.json`;

  let projects: Record<string, ProjectIndexEntry> = {};

  try {
    const content = await readFile(projectsPath, 'utf-8');
    projects = JSON.parse(content);
  } catch {
    // File doesn't exist yet, that's ok
  }

  projects[graph.project] = {
    name: graph.project,
    path: graphDataDir(nodumDataDir, graph.project),
    lastSync: new Date().toISOString(),
    stats: graph.stats,
    stack: {
      languages: analysis.languages,
      frameworks: analysis.frameworks,
    },
  };

  await writeFile(
    projectsPath,
    JSON.stringify(projects, null, 2),
    'utf-8',
  );
}
