import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { resolveJvmImport } from '../parser/import-resolver.js';
import type { Node } from '../types.js';

const MANIFEST_FILENAME = 'AndroidManifest.xml';
const ENTRY_POINT_TAGS = ['application', 'activity', 'service', 'receiver', 'provider'];
const IGNORED_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', '.idea']);

/**
 * Recursively finds every AndroidManifest.xml under `rootPath` — a
 * multi-module Gradle Android project has one per module (`app/`,
 * `feature-x/`, ...), not just one at the project root.
 */
async function findManifests(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      found.push(...(await findManifests(join(dir, entry.name))));
    } else if (entry.name === MANIFEST_FILENAME) {
      found.push(join(dir, entry.name));
    }
  }

  return found;
}

/**
 * Extracts every `android:name` referenced by a platform entry-point tag
 * (`<application>`, `<activity>`, `<service>`, `<receiver>`, `<provider>`),
 * resolved to a fully-qualified class name. These classes are wired up by
 * the manifest at runtime — via reflection, not a Kotlin/Java `import` —
 * so an import-edge-only dead-code check flags them as unreachable despite
 * being real, load-bearing framework entry points.
 *
 * Regex-based, not a full XML parser — the same pragmatic posture this
 * codebase already takes for build-system files it deliberately doesn't
 * parse (no `build.gradle` for `resolveJvmImport`, no `Package.swift` for
 * `resolveSwiftObjcImport`). `android:name` is the only attribute this
 * needs; a real XML parser would add a dependency for no payoff here.
 */
export function parseManifestEntryPoints(xml: string): string[] {
  const packageMatch = xml.match(/<manifest\b[^>]*\spackage\s*=\s*"([^"]+)"/);
  const packageName = packageMatch?.[1];

  const names: string[] = [];
  const tagPattern = new RegExp(`<(?:${ENTRY_POINT_TAGS.join('|')})\\b([^>]*)>`, 'g');
  for (const tagMatch of xml.matchAll(tagPattern)) {
    const nameMatch = tagMatch[1].match(/\sandroid:name\s*=\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const raw = nameMatch[1];

    // `.Foo` → relative to the manifest's package; a bare name with no dots
    // at all is also package-relative (rare, but valid manifest shorthand).
    // Anything else is already a fully-qualified class name.
    if (raw.startsWith('.')) {
      if (packageName) names.push(`${packageName}${raw}`);
    } else if (!raw.includes('.')) {
      if (packageName) names.push(`${packageName}.${raw}`);
    } else {
      names.push(raw);
    }
  }

  return names;
}

/**
 * Finds every AndroidManifest.xml under `rootPath`, extracts its
 * entry-point class references, and resolves each against the graph's
 * known file paths — reusing `resolveJvmImport`'s dotted-FQN suffix
 * matching, the same resolution a Kotlin/Java `import` statement gets.
 * Returns the matching file paths, suitable to pass straight into
 * `detectUnreachableFiles`'s `entryPatterns`.
 */
export async function findManifestEntryFiles(rootPath: string, graphNodes: Node[]): Promise<string[]> {
  const manifests = await findManifests(rootPath);
  if (manifests.length === 0) return [];

  const knownFilesByPath = new Map<string, string>();
  const idToPath = new Map<string, string>();
  for (const node of graphNodes) {
    if (node.type !== 'file') continue;
    knownFilesByPath.set(node.file, node.id);
    idToPath.set(node.id, node.file);
  }

  const entryFiles = new Set<string>();
  for (const manifestPath of manifests) {
    let xml: string;
    try {
      xml = await readFile(manifestPath, 'utf-8');
    } catch {
      continue;
    }

    for (const fqn of parseManifestEntryPoints(xml)) {
      for (const id of resolveJvmImport(fqn, knownFilesByPath)) {
        const path = idToPath.get(id);
        if (path) entryFiles.add(path);
      }
    }
  }

  return [...entryFiles];
}
