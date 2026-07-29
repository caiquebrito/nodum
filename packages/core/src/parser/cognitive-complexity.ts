import type { TSNode } from './treesitter/engine.js';

/**
 * Per-language configuration for `computeCognitiveComplexity` — the
 * *algorithm* (nesting-depth bookkeeping, boolean-sequence collapsing,
 * recursion detection) is shared across all 7 TSNode-based parsers; only
 * *which node types mean what* is language-specific, matching where each
 * parser's own `COMPLEXITY_NODE_TYPES` already lives today.
 *
 * SonarSource-inspired, not a certified implementation of their spec — see
 * `computeCognitiveComplexity`'s own doc comment for the exact, deliberately
 * simplified rule set this implements and why.
 */
export interface CognitiveConfig {
  /** if/for/while/do-while/catch/guard — costs `1 + currentDepth`, and increments depth for its own descendants. */
  nesting: Set<string>;
  /** A lambda/closure literal — not itself scored, but increments depth for its descendants (it's not a separately-scored callable, unlike a named function/method). */
  nestingOnly?: Set<string>;
  /** Function/method declarations — a separately-scored unit; traversal stops here entirely (never descended into from the enclosing unit's walk). */
  boundary: Set<string>;
  /** True if `node` is a boolean `&&`/`||` operator node (dedicated node type or, for a shared binary node, an operator-field check). */
  isBooleanOp?: (node: TSNode) => boolean;
  /** The callee name of a bare (unqualified) call node, or null if `node` isn't a resolvable call. Used for recursion detection. */
  calleeName?: (node: TSNode) => string | null;
}

/**
 * Cognitive complexity, SonarSource-inspired: unlike cyclomatic complexity
 * (which counts every decision point equally, regardless of how deeply
 * nested), this rewards flat code and penalizes nesting — an `if` three
 * levels deep costs more than three sequential `if`s at the top level.
 * Baseline is 0 (not cyclomatic's 1) — a function with no branches has zero
 * cognitive complexity.
 *
 * The rule set implemented here, deliberately simplified from the full
 * SonarSource specification (documented, not silently divergent):
 *
 *  - A nesting construct (if/for/while/do-while/catch/guard) costs
 *    `1 + currentNestingDepth`, and its own body is walked at
 *    `currentNestingDepth + 1`.
 *  - A boolean operator sequence (`a && b && c`) costs `+1` total, not once
 *    per operator — detected by suppressing the increment when a boolean
 *    node's own first operand is itself the same kind of boolean node
 *    (i.e. only the "outermost new" operator in a run counts). Unlike
 *    strict SonarSource semantics, this does NOT further split on an
 *    operator *change* (`a && b || c` collapses to one `+1` here, not two)
 *    — a deliberate simplification, since not every grammar this covers
 *    exposes `&&` vs `||` as distinguishable without an extra field lookup
 *    this spec's config intentionally keeps out of scope.
 *  - Recursion (a bare call whose callee name matches the enclosing unit's
 *    own name, passed as `selfName`) costs a flat `+1`.
 *  - A lambda/closure body increments nesting depth for its own
 *    descendants without a self-increment (it isn't itself a decision
 *    point).
 *
 *  **Known, deliberate divergence from strict SonarSource semantics**: an
 *  `else if` chain is NOT kept flat here. SonarSource scores
 *  `if / else if / else if` as one flat sequence at the same nesting
 *  level; this implementation's simplified depth model instead treats each
 *  successive `else if` as one level deeper than the last (since, in every
 *  grammar this covers, an `else if` is structurally a nested `if` inside
 *  the outer `if`'s alternative branch, and this walker does not special-
 *  case that position). A real fix needs per-grammar branch-field
 *  detection (the "consequence" vs. "alternative" child of an if-like
 *  node) verified individually for all 8 languages — out of scope for this
 *  spec's time budget, tracked as a documented follow-up rather than
 *  silently gotten wrong. Bare `else` (no condition) and `switch`/`when`
 *  statements are similarly not scored at all in this implementation — see
 *  spec 045's Out of scope.
 */
export function computeCognitiveComplexity(bodyNode: TSNode, config: CognitiveConfig, selfName?: string): number {
  let complexity = 0;

  function visit(node: TSNode | null, depth: number): void {
    if (!node) return;

    if (config.boundary.has(node.type)) return;

    if (config.nesting.has(node.type)) {
      complexity += 1 + depth;
      for (const child of node.namedChildren) visit(child, depth + 1);
      return;
    }

    if (config.nestingOnly?.has(node.type)) {
      for (const child of node.namedChildren) visit(child, depth + 1);
      return;
    }

    if (config.isBooleanOp?.(node)) {
      // Whether a boolean-operator chain nests left- or right-associatively
      // is grammar-specific (verified empirically: this codebase's Python
      // grammar nests left, its Swift grammar nests right) — checking the
      // PARENT rather than a specific child is what makes this suppression
      // robust to either direction: a boolean-op node whose own parent is
      // also a boolean op is definitionally part of a chain some ancestor
      // already counted, regardless of which side of that ancestor it's on.
      const parentIsSameKind = node.parent ? (config.isBooleanOp?.(node.parent) ?? false) : false;
      if (!parentIsSameKind) complexity += 1;
      for (const child of node.namedChildren) visit(child, depth);
      return;
    }

    if (selfName && config.calleeName) {
      const callee = config.calleeName(node);
      if (callee === selfName) complexity += 1;
    }

    for (const child of node.namedChildren) visit(child, depth);
  }

  for (const child of bodyNode.namedChildren) visit(child, 0);
  return complexity;
}
