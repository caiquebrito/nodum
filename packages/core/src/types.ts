import type { NodeCluster } from './analyzer/clustering.js';

export type NodeType = 'file' | 'function' | 'class' | 'interface' | 'method';
/**
 * `'calls'` (spec 034) is same-file only: emitted when a function/method
 * calls another function/method defined in the same file, resolved by a
 * flat name lookup within that file (same simplification `defines` edges
 * already use). Cross-file call resolution is a future spec's job.
 */
export type RelationType = 'imports' | 'defines' | 'extends' | 'implements' | 'calls';

export interface Node {
  id: string;
  label: string;
  type: NodeType;
  file: string;
  group: string;
  line?: number;
  embedding?: number[];  // v2.0: Semantic search embeddings (1536-dim)
  clusterId?: string;     // v2.0: Cluster assignment for hierarchical compression
  /** Cyclomatic complexity (McCabe). Only set for function/method nodes whose
   * parser could determine a body; omitted (not zero) when unknown. */
  complexity?: number;
  /** sha256 of the normalized (identifiers/literals replaced with
   * placeholders) body token stream. Only set for function/method nodes
   * whose body met the minimum-size threshold; omitted otherwise. */
  duplicateHash?: string;
}

export interface Edge {
  source: string;
  target: string;
  relation: RelationType;
}

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  /** Raw, unresolved import specifiers extracted from this file. Resolution
   * happens later (graph-gen.ts), once every file in the project is known —
   * a single-file parse() call has no visibility into the rest of the
   * project. Parsers that don't extract imports omit this entirely. */
  imports?: string[];
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
  hash: string;     // sha256 of `content`, hex-encoded
  mtimeMs: number;
  size: number;
}

export interface FileManifestEntry {
  hash: string;
  mtimeMs: number;
  size: number;
}

export type FileManifest = Record<string, FileManifestEntry>; // keyed by relative path

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
