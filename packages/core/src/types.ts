import type { NodeCluster } from './analyzer/clustering.js';

export type NodeType = 'file' | 'function' | 'class' | 'interface' | 'method';
export type RelationType = 'imports' | 'defines' | 'extends' | 'implements';

export interface Node {
  id: string;
  label: string;
  type: NodeType;
  file: string;
  group: string;
  line?: number;
  embedding?: number[];  // v2.0: Semantic search embeddings (1536-dim)
  clusterId?: string;     // v2.0: Cluster assignment for hierarchical compression
}

export interface Edge {
  source: string;
  target: string;
  relation: RelationType;
}

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
}

export interface Graph {
  project: string;
  stats: {
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
    edges: number;
  };
  nodes: Node[];
  edges: Edge[];
  clusters?: NodeCluster[];
  nodeToCluster?: Record<string, string>;
}

export interface ProjectIndexEntry {
  name: string;
  path: string;
  lastSync: string; // ISO timestamp
  stats: Graph['stats'];
  stack: {
    languages: string[];
    frameworks: string[];
  };
}

export interface FileInfo {
  path: string;
  ext: string;
  content: string;
}

export interface ProjectAnalysis {
  languages: string[];
  frameworks: string[];
  databases: string[];
  runtimes: string[];
  buildTools: string[];
  testFrameworks: string[];
  description?: string;
  envVariables?: Record<string, string>;
  scripts?: Record<string, string>;
}

export const NODE_GROUPS = {
  ui: ['ui', 'views', 'fragments', 'activities', 'screens', 'components'],
  service: ['services', 'service', 'api'],
  model: ['models', 'data', 'entities', 'schema', 'types'],
  repo: ['repository', 'repositories', 'repos', 'db'],
  util: ['utils', 'helpers', 'lib', 'common', 'shared'],
  config: ['config', 'settings', 'di', 'constants'],
  test: ['test', 'tests', '__tests__', 'spec', '__spec__', 'androidTest', 'unitTest'],
  hook: ['hooks'],
} as const;

export function getNodeGroup(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [group, dirs] of Object.entries(NODE_GROUPS)) {
    if (dirs.some(dir => lower.includes(`/${dir}/`) || lower.startsWith(`${dir}/`))) {
      return group;
    }
  }
  return 'other';
}

export function normalizeNodeId(filePath: string, name: string, type: NodeType): string {
  const fileId = filePath
    .replace(/[\/\\]/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();

  const nameId = name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();

  return type === 'file' ? fileId : `${fileId}__${nameId}`;
}
