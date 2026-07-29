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
