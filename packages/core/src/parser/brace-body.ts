/**
 * Extracts a function's body text via brace-depth counting, starting the
 * search at `startLineIdx`. Skips characters inside string/template
 * literals (best-effort — doesn't handle nested template-literal
 * expressions or regex literals, a known limitation shared with the rest of
 * these regex-based parsers) and `//` line comments. Bounded to
 * `maxLookaheadLines` before giving up, so a brace-less single-expression
 * arrow function doesn't accidentally consume a later function's body.
 * Returns null if no opening brace is found within the lookahead window, or
 * the body never closes.
 */
export function extractBraceBody(
  lines: string[],
  startLineIdx: number,
  maxLookaheadLines = 3,
): string | null {
  let depth = 0;
  let started = false;
  let inString: '"' | "'" | '`' | null = null;
  const collected: string[] = [];

  for (let i = startLineIdx; i < lines.length; i++) {
    if (!started && i - startLineIdx >= maxLookaheadLines) return null;

    const line = lines[i];
    let bodyLine = '';

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];

      if (inString) {
        bodyLine += ch;
        if (ch === inString && line[c - 1] !== '\\') inString = null;
        continue;
      }

      if (ch === '/' && line[c + 1] === '/') break; // rest of line is a comment

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        bodyLine += ch;
        continue;
      }

      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
      }

      bodyLine += ch;

      if (started && depth === 0) {
        collected.push(bodyLine);
        return collected.join('\n');
      }
    }

    if (started) collected.push(bodyLine);
  }

  return null; // unterminated body
}
