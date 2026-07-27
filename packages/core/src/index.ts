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

export { discoverFiles, discoverChangedFiles, IGNORED_DIRS } from './file-discovery.js';
export type { DiscoveryDiff } from './file-discovery.js';

export { loadScanConfig, saveScanConfig, buildFileMatcher } from './scan-config.js';
export type { ScanConfig, FileMatcher } from './scan-config.js';

export { diffGraphs } from './graph-diff.js';
export type { GraphDiff, NodeChange } from './graph-diff.js';

export type { Parser } from './parser/base.js';
export {
  selectParser,
  getAvailableParsers,
} from './parser/index.js';

export { analyzeProject } from './analyzer/index.js';
export type { EnvVariable } from './analyzer/index.js';

export { buildClusters, expandCluster, getClusterIdForNode, isClusteredNode, findIncomingDeps } from './analyzer/clustering.js';
export type { NodeCluster } from './analyzer/clustering.js';

export { detectCycles } from './analyzer/cycles.js';
export type { Cycle } from './analyzer/cycles.js';

export { detectUnreachableFiles } from './analyzer/dead-code.js';
export type { UnreachableFile, DetectUnreachableFilesOptions } from './analyzer/dead-code.js';

export { detectArchitectureViolations } from './analyzer/architecture.js';
export type { ArchitectureViolation } from './analyzer/architecture.js';
export { loadArchitectureConfig, saveArchitectureConfig } from './analyzer/architecture-config.js';
export type { ArchitectureRule, ArchitectureConfig } from './analyzer/architecture-config.js';

export {
  injectCLAUDEContext,
  appendActivityLog,
  buildAndWriteSummary,
} from './memory/index.js';
