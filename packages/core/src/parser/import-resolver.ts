import { dirname, join, normalize } from 'path';
import { normalizeNodeId } from '../types.js';

const TS_JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Relative-path resolution for TypeScript/JavaScript. Bare/package
 * specifiers (`react`, `lodash`) are always external — no known file could
 * ever match them, so they resolve to null immediately without probing.
 */
export function resolveRelativeImport(
  importingFilePath: string,
  specifier: string,
  knownFileIds: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = normalize(join(dirname(importingFilePath), specifier));
  const hasKnownExtension = TS_JS_EXTENSIONS.some(ext => base.endsWith(ext));

  const candidates = hasKnownExtension
    ? [base]
    : [
        ...TS_JS_EXTENSIONS.map(ext => `${base}${ext}`),
        ...TS_JS_EXTENSIONS.map(ext => join(base, `index${ext}`)),
      ];

  for (const candidate of candidates) {
    const id = normalizeNodeId(candidate, candidate, 'file');
    if (knownFileIds.has(id)) return id;
  }

  return null;
}

/**
 * Dotted-FQN resolution for Kotlin/Java, shared since both coexist in real
 * projects (Android apps especially). Suffix-matches against known file
 * paths — no build-system knowledge of source roots (src/main/kotlin vs
 * src/main/java vs any custom layout) is required.
 *
 * A wildcard import (`com.foo.*`) can resolve to every file in that
 * package. A normal import resolves to at most one file, trying
 * progressively shorter prefixes so member imports
 * (`import com.foo.Bar.CONSTANT`) still resolve — by dropping the last
 * segment and resolving `Bar`.
 */
export function resolveJvmImport(specifier: string, knownFilesByPath: Map<string, string>): string[] {
  const isWildcard = specifier.endsWith('.*');
  const parts = (isWildcard ? specifier.slice(0, -2) : specifier).split('.');

  if (isWildcard) {
    const pkgSuffix = `${parts.join('/')}/`.toLowerCase();
    const matches: string[] = [];
    for (const [path, id] of knownFilesByPath) {
      const dir = path.slice(0, path.lastIndexOf('/') + 1).toLowerCase();
      if (dir.endsWith(pkgSuffix)) matches.push(id);
    }
    return matches;
  }

  for (let drop = 0; drop < parts.length; drop++) {
    const candidateParts = parts.slice(0, parts.length - drop);
    if (candidateParts.length === 0) break;

    const suffixKt = `${candidateParts.join('/')}.kt`.toLowerCase();
    const suffixJava = `${candidateParts.join('/')}.java`.toLowerCase();

    for (const [path, id] of knownFilesByPath) {
      const lower = path.toLowerCase();
      if (
        lower === suffixKt ||
        lower.endsWith(`/${suffixKt}`) ||
        lower === suffixJava ||
        lower.endsWith(`/${suffixJava}`)
      ) {
        return [id];
      }
    }
  }

  return [];
}
