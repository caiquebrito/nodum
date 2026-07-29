import type { Node } from '../types.js';

/**
 * Gradle/Android source-set directory convention: `<module>/src/<name>/kotlin/**`
 * or `.../src/<name>/java/**` (KMP: `commonMain`/`androidMain`/`iosMain`/
 * `commonTest`; classic Android/Java: `main`/`test`/`androidTest`). Purely
 * path-derived — no build-file parsing needed — the same precedent
 * `types.ts`'s `getNodeGroup()` already established for its own path-based
 * `group` field. Validated empirically (spec 049) against 7,027 real files
 * across three real Android projects: >99.9% matched, including
 * product-flavor source sets (`androidTestBahia`, etc.) not anticipated
 * going in.
 */
export const SOURCE_SET_PATTERN = /(?:^|\/)src\/([^/]+)\/(?:kotlin|java)\//;

export function detectSourceSet(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  return SOURCE_SET_PATTERN.exec(normalized)?.[1];
}

/**
 * Stamps or clears `Node.sourceSet` across the full node array, in place.
 * Idempotent by construction: the label is a pure function of `node.file`,
 * itself baked into the node's own id (`normalizeNodeId`) — a file that
 * moves gets a brand-new node id on its next parse, so there is no stale-
 * label case to guard against separately. Called once per sync, over every
 * node (including ones carried over verbatim by incremental sync), from
 * `graph-gen.ts`.
 */
export function applySourceSets(nodes: Node[]): void {
  for (const node of nodes) {
    const sourceSet = detectSourceSet(node.file);
    if (sourceSet) {
      node.sourceSet = sourceSet;
    } else {
      delete node.sourceSet;
    }
  }
}

/**
 * Gradle module path convention: everything before the `/src/<name>/kotlin|java/`
 * segment that `SOURCE_SET_PATTERN` itself matches (e.g.
 * `forro/feature/src/androidMain/kotlin/Foo.kt` → module `forro/feature`).
 * Deliberately gated on the same Kotlin/Java source-set convention as
 * `detectSourceSet`, rather than a bare `.../src/...` split — a generic
 * `/src/` split would false-positive on any non-Gradle project that happens
 * to nest a `src/` directory under a named parent (e.g. this very repo's own
 * `packages/<name>/src/...` layout), which real verification against this
 * monorepo caught directly (593 TypeScript nodes were wrongly tagged with a
 * bare `/src/` split before this gate was added). Validated empirically
 * (spec 051) against a real 56,598-node multi-module Android project: 100%
 * of node file paths matched, yielding all 42 of the modules the project's
 * own `settings.gradle.kts` declares, plus 2 real non-Gradle directories
 * (`buildSrc`, `tests-e2e`) that also happen to follow the same source-set
 * layout convention. Deliberately not attempted: `settings.gradle`'s
 * `include(...)` parsing — found during this spec's research to be *less*
 * reliable than path derivation on real projects (`includeBuild`/
 * `includeGroupByRegex` both false-match a naive `include(` regex, and some
 * real projects build their module list programmatically, unparseable by
 * any regex). A single-module project's files (no path segment before
 * `src/`) get no module label — there is nothing to distinguish.
 */
export const MODULE_PATTERN = /^(.+?)\/src\/[^/]+\/(?:kotlin|java)\//;

export function detectModule(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  return MODULE_PATTERN.exec(normalized)?.[1];
}

/**
 * Stamps or clears `Node.module` across the full node array, in place. Same
 * idempotence argument as `applySourceSets`: a pure function of `node.file`,
 * which is itself baked into the node's own id, so a file that moves to a
 * different module gets a brand-new node id on its next parse rather than a
 * mutated old one.
 */
export function applyModules(nodes: Node[]): void {
  for (const node of nodes) {
    const module = detectModule(node.file);
    if (module) {
      node.module = module;
    } else {
      delete node.module;
    }
  }
}
