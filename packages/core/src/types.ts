import type { NodeCluster } from './analyzer/clustering.js';

/**
 * `'struct'` / `'enum'` / `'protocol'` / `'extension'` (spec 036) were added
 * for Swift/Objective-C (specs 037-038) — a Swift `class_declaration` folds
 * `class`/`struct`/`enum`/`actor`/`extension` into one grammar node, and
 * `protocol` doesn't map cleanly onto `'interface'` (TS/Java interfaces and
 * Swift/ObjC protocols are similar but not identical concepts, and keeping
 * them distinct avoids conflating a Java `interface` node with a Swift
 * `protocol` node when a project mixes languages). `'extension'` has no
 * pre-036 equivalent at all.
 */
export type NodeType =
  | 'file'
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'struct'
  | 'enum'
  | 'protocol'
  | 'extension';
/**
 * `'calls'` (spec 034) is same-file only: emitted when a function/method
 * calls another function/method defined in the same file, resolved by a
 * flat name lookup within that file (same simplification `defines` edges
 * already use). Cross-file call resolution is a future spec's job.
 * `'actualizes'` (spec 055) points from a Kotlin `actual` declaration to the
 * `expect` declaration it fulfills — the one genuinely cross-source-set edge
 * this codebase produces, resolved by `analyzer/expect-actual.ts`'s
 * `applyExpectActual()` post-pass rather than any parser-level mechanism.
 */
export type RelationType = 'imports' | 'defines' | 'extends' | 'implements' | 'calls' | 'actualizes';

export interface Node {
  id: string;
  label: string;
  type: NodeType;
  file: string;
  group: string;
  line?: number;
  embedding?: number[];  // v2.0: Semantic search embeddings (384-dim, Xenova/all-MiniLM-L6-v2)
  clusterId?: string;     // v2.0: Cluster assignment for hierarchical compression
  /** Cyclomatic complexity (McCabe). Only set for function/method nodes whose
   * parser could determine a body; omitted (not zero) when unknown. */
  complexity?: number;
  /** Cognitive complexity (SonarSource-inspired, spec 045) — nesting-depth-
   * aware, unlike `complexity` above. Set alongside `complexity` whenever a
   * parser could determine a body, never replacing it. See
   * `cognitive-complexity.ts`'s doc comment for the exact rule set. */
  cognitiveComplexity?: number;
  /** sha256 of the normalized (identifiers/literals replaced with
   * placeholders) body token stream. Only set for function/method nodes
   * whose body met the minimum-size threshold; omitted otherwise. */
  duplicateHash?: string;
  /** MinHash-style structural similarity signature (spec 048) — 32 lanes x
   * 16 bits, hex-encoded, over 5-gram shingles of the same normalized
   * token stream that feeds `duplicateHash`. Consumed only by
   * `findSimilarCode`'s fuzzy-match path. Set only for bodies clearing a
   * strictly higher token-count floor than `duplicateHash`'s — a node can
   * carry one, both, or neither field. See `similarity-signature.ts`. */
  similaritySignature?: string;
  /** Gradle/Android source set (`commonMain`, `androidMain`, `test`, ...),
   * derived purely from `file`'s path via `analyzer/source-set.ts`'s
   * `detectSourceSet()` — same path-convention precedent as `group` above.
   * Set for any file under a `src/<name>/kotlin|java/` path, not only
   * Kotlin files (a plain Java/Gradle project uses the same convention). */
  sourceSet?: string;
  /** Gradle module path (`forro/feature`, `app`, ...), derived purely from
   * `file`'s path via `analyzer/source-set.ts`'s `detectModule()` — everything
   * before the same Kotlin/Java source-set convention `sourceSet` itself
   * matches, so it never fires on a non-Gradle project's own `src/` layout.
   * Unset for single-module projects (spec 051). */
  module?: string;
  /** Kotlin `expect`/`actual` platform modifier (spec 055), extracted purely
   * from the declaration's own `platform_modifier` grammar node — set only
   * for top-level function and type (class/interface/enum/object)
   * declarations; `expect`/`actual` on a top-level property (`val`/`var`) is
   * out of scope since this parser doesn't extract properties as nodes at
   * all today, and `expect class` *members* are deliberately not walked for
   * this. Consumed only by `analyzer/expect-actual.ts`'s pairing pass. */
  platformModifier?: 'expect' | 'actual';
  /** Every distinct bare identifier/type name referenced anywhere in this
   * file (not just calls, not just top-level) — only set on `type: 'file'`
   * nodes, and currently only populated by the Kotlin parser. Exists to
   * resolve Kotlin's same-package, no-`import`-needed visibility: a
   * top-level `internal`/public declaration referenced unqualified by a
   * sibling file in the same directory has no `imports` edge to show for
   * it, so `detectUnreachableFiles` cross-checks this set against sibling
   * files' declared symbol names before flagging a file dead. Deliberately
   * coarse (every identifier, not scope-resolved against locals/params) —
   * same flat-name-lookup posture `calls` edges already take within a
   * single file; a stray same-named local variable causing an occasional
   * false *negative* here is the accepted trade-off for fewer dead-code
   * false positives. */
  referencedIdentifiers?: string[];
  /** Every top-level declaration name in this file (classes/interfaces/enums/
   * objects, top-level functions, AND top-level properties) — only set on
   * `type: 'file'` nodes, currently only populated by the Kotlin parser.
   * Exists alongside `referencedIdentifiers` for the same same-package
   * dead-code resolution: a top-level `val`/`var` (e.g. a Koin
   * `val commonModule = module { ... }`) never gets its own graph `Node`
   * at all (this parser doesn't extract properties as nodes, see
   * `platformModifier`'s doc comment) — so it would otherwise be
   * invisible to `usedBySamePackageSibling`'s "does some sibling reference
   * one of this file's declared symbols" check, which reads *declared*
   * `Node`s' labels for every other symbol kind. */
  declaredTopLevelNames?: string[];
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
    /** Optional (spec 036): a pre-036 graph.json / ProjectIndexEntry on disk
     * won't have these. buildStats() always populates all four on any graph
     * generated after this spec — optionality exists purely so old on-disk
     * data stays a valid Graph['stats'], not because a fresh sync ever omits
     * them. Kept as their own counters rather than folded into `classes`/
     * `interfaces` so a Swift/ObjC-heavy project's composition is visible
     * rather than silently absorbed into an unrelated language's numbers. */
    structs?: number;
    enums?: number;
    protocols?: number;
    extensions?: number;
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
