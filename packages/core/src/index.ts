// Sync orchestrator
export { syncProject, writeGraphFile } from './sync.js';
export type { SyncHooks } from './sync.js';

export { ensureLiftoffOnly } from './runtime/liftoff-respawn.js';

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
  buildRawGraphDumpText,
} from './graph-gen.js';
export type { GenerateGraphOptions } from './graph-gen.js';

export { discoverFiles, discoverChangedFiles, IGNORED_DIRS } from './file-discovery.js';
export type { DiscoveryDiff } from './file-discovery.js';

export { loadScanConfig, saveScanConfig, buildFileMatcher } from './scan-config.js';
export type { ScanConfig, FileMatcher } from './scan-config.js';

export { diffGraphs } from './graph-diff.js';
export type { GraphDiff, NodeChange } from './graph-diff.js';

export { Parser } from './parser/base.js';
export {
  selectParser,
  getAvailableParsers,
  registerParser,
} from './parser/index.js';

export { analyzeProject } from './analyzer/index.js';
export type { EnvVariable } from './analyzer/index.js';

export { buildClusters, expandCluster, getClusterIdForNode, isClusteredNode, findIncomingDeps } from './analyzer/clustering.js';
export type { NodeCluster } from './analyzer/clustering.js';

export { detectCycles } from './analyzer/cycles.js';
export type { Cycle } from './analyzer/cycles.js';

export { detectUnreachableFiles } from './analyzer/dead-code.js';
export type { UnreachableFile, DetectUnreachableFilesOptions } from './analyzer/dead-code.js';
export { findManifestEntryFiles, parseManifestEntryPoints } from './analyzer/android-manifest.js';
export { findCiInvokedFiles, parseCiInvokedPaths } from './analyzer/ci-invoked-scripts.js';

export { detectArchitectureViolations } from './analyzer/architecture.js';
export type { ArchitectureViolation } from './analyzer/architecture.js';
export { loadArchitectureConfig, saveArchitectureConfig } from './analyzer/architecture-config.js';
export type { ArchitectureRule, ArchitectureConfig } from './analyzer/architecture-config.js';

export { rankByComplexity } from './analyzer/complexity.js';
export type { ComplexityRanking, RankByComplexityOptions } from './analyzer/complexity.js';

export { detectDuplicates } from './analyzer/duplication.js';
export type { DuplicateGroup } from './analyzer/duplication.js';

export { traceImpact } from './analyzer/impact.js';
export type { ImpactedFile, TraceImpactOptions } from './analyzer/impact.js';

export { findBottlenecks } from './analyzer/bottlenecks.js';
export type { Bottleneck, FindBottlenecksOptions } from './analyzer/bottlenecks.js';

export { explainArchitecture } from './analyzer/architecture-summary.js';
export type { ArchitectureSummary, LayerSummary, LayerDependency } from './analyzer/architecture-summary.js';

export { findSimilarCode, DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_SIMILAR_CODE_LIMIT } from './analyzer/similar-code.js';
export type { SimilarCodeResult, SimilarCodeMatch, SimilarCodeOptions } from './analyzer/similar-code.js';

export { detectNearDuplicates, DEFAULT_NEAR_DUPLICATE_LIMIT } from './analyzer/near-duplicate.js';
export type {
  NearDuplicateGroup,
  NearDuplicateGroupMember,
  DetectNearDuplicatesOptions,
  DetectNearDuplicatesResult,
} from './analyzer/near-duplicate.js';

export { suggestRefactoring } from './analyzer/suggest-refactoring.js';
export type {
  RefactoringSuggestion,
  RefactoringSuggestionKind,
  SuggestRefactoringOptions,
} from './analyzer/suggest-refactoring.js';

export {
  injectCLAUDEContext,
  appendActivityLog,
  buildAndWriteSummary,
  appendMetricsLog,
} from './memory/index.js';
export type { ToolCallMetric } from './memory/index.js';

export { checkLatestVersion, formatUpdateNotice } from './version-check.js';
export type { VersionCheckResult } from './version-check.js';

export { countTokens } from './token-count.js';
