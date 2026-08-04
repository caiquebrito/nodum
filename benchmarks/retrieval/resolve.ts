/**
 * Resolves golden-set selectors — `{ file, label, type }` — against a real
 * generated graph. Selectors, not raw node ids, are the source of truth in
 * golden-set.json (see its `$comment`): ids are a derived encoding
 * (`normalizeNodeId` in packages/core/src/types.ts) and selectors stay
 * meaningful even if that encoding changes.
 *
 * Resolution is deliberately strict: a selector matching zero or more than
 * one node throws, rather than silently scoring against the wrong node or
 * an empty set. A golden set that's drifted out of sync with its fixture
 * (a renamed function, a method that became ambiguous) should fail loudly
 * in CI, not quietly under-count relevance.
 */
import type { Graph } from '@caiquebrito/nodum-core';

export interface NodeSelector {
  file: string;
  label: string;
  type: string;
}

export function resolveSelector(graph: Graph, selector: NodeSelector): string {
  const matches = graph.nodes.filter(
    (n) => n.file === selector.file && n.label === selector.label && n.type === selector.type,
  );

  if (matches.length === 0) {
    throw new Error(
      `Golden-set selector matched no node: ${JSON.stringify(selector)} in fixture graph "${graph.project}". ` +
        `Either the fixture source changed or the selector is wrong — fix golden-set.json, don't loosen this check.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Golden-set selector is ambiguous — matched ${matches.length} nodes: ${JSON.stringify(selector)} in fixture graph "${graph.project}". ` +
        `Add a disambiguating detail (this resolver only matches on file+label+type) or pick a query whose target is unique.`,
    );
  }

  return matches[0].id;
}

export function resolveSelectors(graph: Graph, selectors: NodeSelector[]): Set<string> {
  return new Set(selectors.map((s) => resolveSelector(graph, s)));
}
