// Sync orchestrator
export { syncProject, writeGraphFile } from './sync.js';
export type { SyncHooks } from './sync.js';

export type {
  Node,
  Edge,
  ParseResult,
  Graph,
  FileInfo,
  FileManifest,
  FileManifestEntry,
  ProjectAnalysis,
  ProjectIndexEntry,
  NodeType,
  RelationType,
} from './types.js';

export {
  getNodeGroup,
  normalizeNodeId,
  NODE_GROUPS,
} from './types.js';

export {
  generateGraph,
  calculateNodeDegree,
  deduplicateEdges,
} from './graph-gen.js';
export type { GenerateGraphOptions } from './graph-gen.js';

export { discoverFiles, discoverChangedFiles } from './file-discovery.js';
export type { DiscoveryDiff } from './file-discovery.js';

export type { Parser } from './parser/base.js';
export {
  selectParser,
  getAvailableParsers,
} from './parser/index.js';

export { analyzeProject } from './analyzer/index.js';
export type { EnvVariable } from './analyzer/index.js';

export { buildClusters, expandCluster, getClusterIdForNode, isClusteredNode, findIncomingDeps } from './analyzer/clustering.js';
export type { NodeCluster } from './analyzer/clustering.js';

export {
  injectCLAUDEContext,
  appendActivityLog,
  buildAndWriteSummary,
} from './memory/index.js';
