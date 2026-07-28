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

/**
 * Dotted-module resolution for Python. Specifiers come in two shapes
 * (encoded by `PythonParser.parse()` — see spec 031):
 *
 *  - Absolute (`os.path`, no leading dot): suffix-matched against known file
 *    paths the same pragmatic way `resolveJvmImport` handles Java/Kotlin's
 *    dotted FQNs — Python has no single enforced "source root" convention
 *    either, so there's no better option without build-system knowledge.
 *  - Relative (`.pkg`, `..pkg`, `.sibling` — leading dots count package
 *    levels up from the importing file's own directory, exactly matching
 *    Python's `from . import x` / `from .. import x` semantics): resolved
 *    as an *exact* path relative to the importing file, since a relative
 *    import's target is unambiguous — unlike an absolute import, whose
 *    source root nodum has no way to know.
 *
 * Both forms try `<path>.py` and `<path>/__init__.py`, since
 * `import_from_statement`'s module can name either a plain module file or a
 * package directory.
 */
/**
 * Module-name resolution for Swift (spec 037). `import Foo` / `import
 * Foo.Bar` specifiers have no file-path shape at all — Swift resolves them
 * against a compiled module graph (`Package.swift`, `.xcodeproj`), which
 * this function deliberately doesn't parse (same reduction `resolveJvmImport`
 * makes for `pom.xml`/`build.gradle`: no build-system knowledge of source
 * roots is required). Instead, the first dotted segment is treated as a
 * directory-name segment and suffix-matched against known file paths — this
 * matches both SPM (`Sources/Foo/**`) and CocoaPods (`Pods/Foo/**`) layouts
 * without knowing which one a given project uses. A module matching many
 * files resolves to all of them (the same wildcard-style behavior
 * `resolveJvmImport` gives `com.foo.*`); a system module (`Foundation`,
 * `UIKit`) simply matches nothing and resolves to `[]` — no allowlist of
 * system modules is needed.
 */
export function resolveSwiftImport(
  specifier: string,
  _importingFilePath: string,
  _knownFileIds: Set<string>,
  knownFilesByPath: Map<string, string>,
): string[] {
  const moduleName = specifier.split('.')[0];
  if (!moduleName) return [];

  const dirSuffix = `/${moduleName}/`.toLowerCase();
  const matches: string[] = [];
  for (const [path, id] of knownFilesByPath) {
    const dir = path.slice(0, path.lastIndexOf('/') + 1).toLowerCase();
    if (dir.endsWith(dirSuffix) || dir === `${moduleName.toLowerCase()}/`) matches.push(id);
  }
  return matches;
}

export function resolvePythonImport(
  specifier: string,
  importingFilePath: string,
  knownFileIds: Set<string>,
  knownFilesByPath: Map<string, string>,
): string[] {
  const match = specifier.match(/^(\.*)(.*)$/);
  const dots = match ? match[1] : '';
  const rest = match ? match[2] : specifier;
  const segments = rest ? rest.split('.') : [];

  if (dots.length === 0) {
    for (let drop = 0; drop < segments.length; drop++) {
      const candidateParts = segments.slice(0, segments.length - drop);
      if (candidateParts.length === 0) break;

      const suffixFile = `${candidateParts.join('/')}.py`.toLowerCase();
      const suffixPkg = `${candidateParts.join('/')}/__init__.py`.toLowerCase();

      for (const [path, id] of knownFilesByPath) {
        const lower = path.toLowerCase();
        if (
          lower === suffixFile ||
          lower.endsWith(`/${suffixFile}`) ||
          lower === suffixPkg ||
          lower.endsWith(`/${suffixPkg}`)
        ) {
          return [id];
        }
      }
    }
    return [];
  }

  if (segments.length === 0) return [];

  // One dot = "this package" (the importing file's own directory); each
  // additional dot goes up one more parent level.
  let dir = dirname(importingFilePath);
  for (let i = 1; i < dots.length; i++) dir = dirname(dir);

  const candidateFile = normalize(join(dir, `${segments.join('/')}.py`));
  const candidatePkg = normalize(join(dir, segments.join('/'), '__init__.py'));

  for (const candidate of [candidateFile, candidatePkg]) {
    const id = normalizeNodeId(candidate, candidate, 'file');
    if (knownFileIds.has(id)) return [id];
  }

  return [];
}
