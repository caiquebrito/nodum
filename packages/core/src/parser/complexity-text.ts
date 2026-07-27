/**
 * Regex-based cyclomatic complexity over already-extracted body text, for
 * the non-AST parsers (JS/Kotlin/Java). Deliberately excludes ternary
 * (`?:`) — a bare `?` is a false-positive minefield across this group
 * specifically (Kotlin nullable types like `String?`, optional-parameter
 * syntaxes), unlike TypeScript's AST-based computation which detects
 * `ConditionalExpression` nodes exactly. A known, documented undercount for
 * these three languages — see spec 014.
 */
export function countCyclomaticComplexity(bodyText: string): number {
  const patterns = [
    /\bif\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcatch\s*\(/g,
    /\bcase\s+[^:]+:/g,
    /&&/g,
    /\|\|/g,
  ];
  return 1 + patterns.reduce((sum, re) => sum + (bodyText.match(re)?.length ?? 0), 0);
}
