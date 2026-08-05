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
 * `method`-typed node id -> its enclosing type's label, from `defines`
 * edges (a class/object/interface/enum always `defines` its own methods,
 * kotlin.ts's only source of a method-targeted `defines` edge). Built once,
 * not looked up per actual/expect pair inside the O(actuals × expects) loop
 * below — same reasoning as this file's own `edges.length = writeIndex`
 * in-place filter just above (specs 052/059's "don't turn an O(n) pass into
 * something quadratic" lesson, spec 075 applying it a third time in this
 * area of the codebase rather than repeating the mistake). Needed since
 * spec 075: once class-body members can carry a `platformModifier`, two
 * different `expect`/`actual class` pairs in the same module with a
 * same-named member (a real, plausible KMP pattern) would otherwise
 * cross-link — module + kind + label alone doesn't disambiguate which
 * class a method belongs to.
 */
function buildMethodEnclosingTypeLabels(nodes: Node[], edges: Edge[]): Map<string, string> {
  const nodesById = new Map(nodes.map(n => [n.id, n]));
  const enclosingLabelByMethodId = new Map<string, string>();
  for (const edge of edges) {
    if (edge.relation !== 'defines') continue;
    const target = nodesById.get(edge.target);
    if (target?.type !== 'method') continue;
    const source = nodesById.get(edge.source);
    if (source) enclosingLabelByMethodId.set(target.id, source.label);
  }
  return enclosingLabelByMethodId;
}

/**
 * Links each Kotlin `actual` node to the `expect` node it fulfills, via a new
 * `'actualizes'` edge (`actual` → `expect`) — the one genuinely cross-
 * source-set relationship this codebase produces. A pair is linked when,
 * within the same `Node.module`: the declaration kinds match (`function`,
 * `method`, or the same collapsed type kind for `class`/`interface`/`enum`),
 * the labels match, a `method` pair's enclosing types also match (spec 075
 * — see `buildMethodEnclosingTypeLabels`), and the `actual`'s source set is
 * a legitimate dependent of the `expect`'s per the convention above.
 *
 * Matching by module + kind + label (not also package path) is a
 * deliberate scope reduction, not an oversight: this parser doesn't extract
 * Kotlin package declarations at all today, and real verification against
 * a genuine KMP project found zero same-module/same-kind/same-label
 * collisions among its real `expect`/`actual` pairs — module scoping alone
 * was sufficient to disambiguate two same-named declarations
 * (`platformModule`) that live in different modules. That verification
 * predates class-body members ever carrying a `platformModifier` at all
 * (spec 075) — the enclosing-type check above exists precisely because
 * module scoping alone stops being sufficient once methods can collide by
 * name across different classes in the same module.
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
  // In-place filter, not `edges.push(...preserved)` — spreading a large
  // array as individual call arguments overflows V8's call stack once the
  // array is big enough (confirmed via a real ~21,447-file project's actual
  // stack trace: this exact line, with a real ~200,000+-edge array). Same
  // class of bug spec 052 already found and fixed once (`Math.min(...arr)`
  // in the near-duplicate grouping code) — a lesson that didn't carry over
  // to this file, written in the same batch.
  let writeIndex = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].relation !== 'actualizes') {
      edges[writeIndex++] = edges[i];
    }
  }
  edges.length = writeIndex;

  const expects = nodes.filter(n => n.platformModifier === 'expect');
  const actuals = nodes.filter(n => n.platformModifier === 'actual');
  if (expects.length === 0 || actuals.length === 0) return;

  const enclosingTypeLabelByMethodId = buildMethodEnclosingTypeLabels(nodes, edges);

  for (const actual of actuals) {
    for (const expect of expects) {
      if (actual.module !== expect.module) continue;
      if (actual.type !== expect.type) continue;
      if (actual.label !== expect.label) continue;
      // Only relevant for method-typed nodes (spec 075) — a top-level
      // function/class/interface/enum has no enclosing type to disambiguate
      // by in the first place, so this map has no entry for it and the
      // check is skipped, matching pre-075 behavior exactly for every case
      // that isn't a class-body member.
      if (
        actual.type === 'method' &&
        enclosingTypeLabelByMethodId.get(actual.id) !== enclosingTypeLabelByMethodId.get(expect.id)
      ) {
        continue;
      }
      if (!actualSourceSetFulfillsExpect(actual.sourceSet, expect.sourceSet)) continue;

      edges.push({ source: actual.id, target: expect.id, relation: 'actualizes' });
    }
  }
}
