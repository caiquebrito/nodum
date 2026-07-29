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
// A quoted ObjC include always ends in a real file extension (`.h`/`.m`/
// `.mm`) — that's what distinguishes it from a Swift dotted-submodule
// specifier like `UIKit.UIView`, which also contains a `.` but never ends
// in one of these.
const QUOTED_FILE_EXTENSION = /\.(h|m|mm)$/i;

/**
 * Shared Swift + Objective-C import resolution (spec 039, unifying specs
 * 037/038's formerly-separate `resolveSwiftImport`/`resolveObjcImport` —
 * same precedent as `resolveJvmImport` being shared by Java/Kotlin). Two
 * specifier shapes:
 *
 *  - **Quoted file** (`#import "Foo.h"` / `#include "Foo.h"`, detected via
 *    `QUOTED_FILE_EXTENSION`): bare-filename suffix match against
 *    `knownFilesByPath`, mirroring `resolveRelativeImport`'s shape (not
 *    reused directly — that function is TS/JS-extension-specific and
 *    requires a leading `.`, which a bare ObjC filename never has). If no
 *    exact-extension match is found, also probes the same base name as a
 *    `.swift` file — the cross-language payoff: an `#import "Foo.h"` still
 *    resolves if `Foo` is a Swift class (a generated/bridging header
 *    shares its base name with the `.swift` file it exposes).
 *  - **Bare module name** (Swift `import Foo` / `import Foo.Bar` — only the
 *    first dotted segment is the module; ObjC `@import Foo;`): directory-
 *    suffix match against every known file, **regardless of extension** —
 *    this is what makes cross-language interop free: a module resolves to
 *    its `.swift`/`.m`/`.h` files together, with neither parser needing to
 *    know the other's file extensions exist. Matches both SPM
 *    (`Sources/Foo/**`) and CocoaPods (`Pods/Foo/**`) layouts without
 *    parsing `Package.swift`/`.xcodeproj`/`Podfile` (same build-system-
 *    knowledge reduction `resolveJvmImport` makes for `pom.xml`/
 *    `build.gradle`). A module matching many files resolves to all of them
 *    (the same wildcard-style behavior `resolveJvmImport` gives
 *    `com.foo.*`); a system/SDK module (`Foundation`, `UIKit`) simply
 *    matches nothing — no allowlist needed.
 */
export function resolveSwiftObjcImport(
  specifier: string,
  _importingFilePath: string,
  _knownFileIds: Set<string>,
  knownFilesByPath: Map<string, string>,
): string[] {
  if (QUOTED_FILE_EXTENSION.test(specifier)) {
    const lower = specifier.toLowerCase();
    for (const [path, id] of knownFilesByPath) {
      const pathLower = path.toLowerCase();
      if (pathLower === lower || pathLower.endsWith(`/${lower}`)) return [id];
    }

    const base = specifier.replace(/\.[^./]+$/, '');
    const swiftLower = `${base}.swift`.toLowerCase();
    for (const [path, id] of knownFilesByPath) {
      const pathLower = path.toLowerCase();
      if (pathLower === swiftLower || pathLower.endsWith(`/${swiftLower}`)) return [id];
    }
    return [];
  }

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

/**
 * Package-path resolution for Go. A specifier (`"github.com/foo/bar"`,
 * `"myapp/internal/svc"`) names a whole PACKAGE — unlike every other
 * resolver here, it resolves to every `.go` file in the matching directory,
 * not at most one file. Tries progressively shorter suffixes of the path
 * (dropping the module-host/vanity-import-path prefix one segment at a
 * time), directory-suffix-matching against `knownFilesByPath` — the same
 * zero-build-system-knowledge posture `resolveJvmImport` takes for
 * `pom.xml`/`build.gradle` and `resolveSwiftObjcImport` takes for
 * `Package.swift`/`Podfile` (no `go.mod` parsing). A stdlib import
 * (`"fmt"`, `"net/http"`) simply matches nothing — no allowlist needed.
 */
export function resolveGoImport(
  specifier: string,
  _importingFilePath: string,
  _knownFileIds: Set<string>,
  knownFilesByPath: Map<string, string>,
): string[] {
  const parts = specifier.split('/').filter(Boolean);

  for (let start = 0; start < parts.length; start++) {
    const dirSuffix = `${parts.slice(start).join('/')}/`.toLowerCase();
    const matches: string[] = [];

    for (const [path, id] of knownFilesByPath) {
      const lower = path.toLowerCase();
      if (!lower.endsWith('.go')) continue;
      const dir = lower.slice(0, lower.lastIndexOf('/') + 1);
      if (dir.endsWith(`/${dirSuffix}`) || dir === dirSuffix) matches.push(id);
    }

    if (matches.length > 0) return matches;
  }

  return [];
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
