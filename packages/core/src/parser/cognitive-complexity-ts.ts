import ts from 'typescript';

/**
 * `ts.Node`/`SyntaxKind`-native twin of `cognitive-complexity.ts`'s
 * `computeCognitiveComplexity` — same algorithm and the same documented,
 * deliberate simplifications (see that module's doc comment), kept as a
 * separate implementation rather than adapted through a shared interface:
 * `ts.Node`'s child iteration (`ts.forEachChild`) and type identity
 * (`node.kind`/`ts.SyntaxKind`) are different enough from `TSNode`'s that a
 * shared abstraction would leak more than it would save for one ~50-line
 * walker (see spec 045's Design for the considered-and-rejected
 * alternative).
 */
export function computeCognitiveComplexityTs(bodyNode: ts.Node, selfName?: string): number {
  let complexity = 0;

  const NESTING_KINDS = new Set([
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.CatchClause,
  ]);

  const visit = (node: ts.Node, depth: number): void => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      return; // separately-scored unit
    }

    if (NESTING_KINDS.has(node.kind)) {
      complexity += 1 + depth;
      ts.forEachChild(node, child => visit(child, depth + 1));
      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      // Not a separately-scored unit (mirroring computeComplexity's own
      // treatment) — rolls into the enclosing scope, but does increment
      // nesting depth for its own body.
      ts.forEachChild(node, child => visit(child, depth + 1));
      return;
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        // See cognitive-complexity.ts's own boolean-chain comment: checking
        // the parent (not a specific child) is what stays correct
        // regardless of associativity direction — kept consistent with the
        // shared TSNode walker even though JS/TS's `&&`/`||` are guaranteed
        // left-associative by the language spec.
        const parent = node.parent;
        const parentIsSameKind =
          parent && ts.isBinaryExpression(parent) &&
          (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            parent.operatorToken.kind === ts.SyntaxKind.BarBarToken);
        if (!parentIsSameKind) complexity += 1;
        ts.forEachChild(node, child => visit(child, depth));
        return;
      }
    }

    if (selfName && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === selfName) {
      complexity += 1;
    }

    ts.forEachChild(node, child => visit(child, depth));
  };

  ts.forEachChild(bodyNode, child => visit(child, 0));
  return complexity;
}
