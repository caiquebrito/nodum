/** Cross-language keyword allow-list — anything else identifier-shaped
 * becomes a generic ID placeholder. Approximate on purpose (no real
 * tokenizer for these three languages); covers the common C-family/
 * JVM-family surface, not exhaustive. */
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'class', 'interface',
  'extends', 'implements', 'function', 'fun', 'val', 'var', 'let', 'const', 'public',
  'private', 'protected', 'static', 'final', 'void', 'null', 'true', 'false', 'this',
  'super', 'import', 'package', 'async', 'await',
]);

/** Matches one token at a time: a string/template literal, a number, an
 * identifier, or a single punctuation/operator character. Punctuation is
 * matched one character at a time deliberately — it passes through as its
 * own token regardless of spacing (`if(x){` tokenizes the same as
 * `if (x) {`), which whitespace-splitting alone would not achieve. */
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\d+(?:\.\d+)?|[a-zA-Z_$][a-zA-Z0-9_$]*|[^\sa-zA-Z0-9_$]/g;

/**
 * Tokenizes already brace-extracted body text into a normalized stream:
 * string/number literals become `LIT`, identifiers not in the shared
 * keyword list become `ID`, everything else (keywords, punctuation) passes
 * through unchanged. Approximates AST-based normalization without a real
 * tokenizer — best-effort, same honesty posture as spec 014's regex-based
 * complexity counting.
 */
export function normalizeBodyTokens(bodyText: string): string[] {
  const matches = bodyText.match(TOKEN_RE) ?? [];
  return matches.map(tok => {
    if (tok[0] === '"' || tok[0] === "'" || tok[0] === '`') return 'LIT';
    if (/^\d/.test(tok)) return 'LIT';
    if (/^[a-zA-Z_$]/.test(tok)) return KEYWORDS.has(tok) ? tok : 'ID';
    return tok; // punctuation/operator character
  });
}
