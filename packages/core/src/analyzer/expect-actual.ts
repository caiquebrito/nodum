import type { Node, Edge } from '../types.js';

/**
 * Which source set an `actual` declaration may legitimately live in,
 * relative to the source set its `expect` counterpart is declared in —
 * Kotlin's *default hierarchy template*. Purely an internal validation rule
 * for `applyExpectActual` below, deliberately not exposed as its own
 * user-facing graph artifact: real-world verification (spec 055) found
 * these edges are almost never explicitly declared in a real project's
 * Gradle files at all (the default template covers virtually every real
 * project), so parsing `settings.gradle`/`build.gradle.kts` for them would
 * have found nothing to parse.
 */
const SOURCE_SET_DEPENDS_ON_COMMON: Record<string, string> = {
  androidMain: 'commonMain',
  iosMain: 'commonMain',
  jvmMain: 'commonMain',
  jsMain: 'commonMain',
  androidTest: 'commonTest',
  iosTest: 'commonTest',
  jvmTest: 'commonTest',
  jsTest: 'commonTest',
};

function actualSourceSetFulfillsExpect(actualSourceSet: string | undefined, expectSourceSet: string | undefined): boolean {
  if (!actualSourceSet || !expectSourceSet) return false;
  if (actualSourceSet === expectSourceSet) return true; // e.g. both commonMain, in a nested hierarchy
  return SOURCE_SET_DEPENDS_ON_COMMON[actualSourceSet] === expectSourceSet;
}

/**
 * Links each Kotlin `actual` node to the `expect` node it fulfills, via a new
 * `'actualizes'` edge (`actual` → `expect`) — the one genuinely cross-
 * source-set relationship this codebase produces. A pair is linked when,
 * within the same `Node.module`: the declaration kinds match (`function`,
 * or the same collapsed type kind for `class`/`interface`/`enum`), the
 * labels match, and the `actual`'s source set is a legitimate dependent of
 * the `expect`'s per the convention above.
 *
 * Matching by module + kind + label (not also package path) is a
 * deliberate scope reduction, not an oversight: this parser doesn't extract
 * Kotlin package declarations at all today, and real verification against
 * a genuine KMP project found zero same-module/same-kind/same-label
 * collisions among its real `expect`/`actual` pairs — module scoping alone
 * was sufficient to disambiguate two same-named declarations
 * (`platformModule`) that live in different modules.
 *
 * Called once per sync, over the full node array (including nodes carried
 * over verbatim by incremental sync) — same "whole graph, every sync"
 * posture as `applySourceSets`/`applyModules`, and for the same reason: a
 * newly-added `actual` must link correctly to a pre-existing `expect` (or
 * vice versa) even when only one side's file was touched. Mutates `edges`
 * in place: clears any previously-computed `'actualizes'` edges first (an
 * incremental sync's edge carry-over doesn't distinguish relation type), so
 * re-running this is idempotent and self-correcting rather than additive.
 */
export function applyExpectActual(nodes: Node[], edges: Edge[]): void {
  const preserved = edges.filter(e => e.relation !== 'actualizes');
  edges.length = 0;
  edges.push(...preserved);

  const expects = nodes.filter(n => n.platformModifier === 'expect');
  const actuals = nodes.filter(n => n.platformModifier === 'actual');
  if (expects.length === 0 || actuals.length === 0) return;

  for (const actual of actuals) {
    for (const expect of expects) {
      if (actual.module !== expect.module) continue;
      if (actual.type !== expect.type) continue;
      if (actual.label !== expect.label) continue;
      if (!actualSourceSetFulfillsExpect(actual.sourceSet, expect.sourceSet)) continue;

      edges.push({ source: actual.id, target: expect.id, relation: 'actualizes' });
    }
  }
}
