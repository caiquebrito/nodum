import { readFile, access, readdir } from 'fs/promises';
import type { Dirent } from 'fs';
import { join } from 'path';

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJSONFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

export async function readPackageJson(projectPath: string): Promise<Record<string, any> | null> {
  return readJSONFile(join(projectPath, 'package.json'));
}

export async function readPyprojectToml(projectPath: string): Promise<string | null> {
  // Simple TOML parser would be better, but for MVP we just read
  return readTextFile(join(projectPath, 'pyproject.toml'));
}

export async function readGoMod(projectPath: string): Promise<string | null> {
  return readTextFile(join(projectPath, 'go.mod'));
}

export async function readCargoToml(projectPath: string): Promise<string | null> {
  return readTextFile(join(projectPath, 'Cargo.toml'));
}

// Modern Kotlin Multiplatform/Android projects are commonly Kotlin-DSL-only
// (`.gradle.kts`/`settings.gradle.kts`) — the plain `.gradle` (Groovy) names
// alone missed them entirely before spec 049, so a real Kotlin/Android
// project could sync with `languages`/`buildTools`/`frameworks` all empty.
// First-found-wins, matching every other multi-candidate reader in this file
// (`readDockerCompose`, `readEnvExample`, `readREADME`).
export async function readBuildGradle(projectPath: string): Promise<string | null> {
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    const content = await readTextFile(join(projectPath, name));
    if (content) return content;
  }
  return null;
}

/** Depth-1 subdirectory names never worth reading a build file from. */
const GRADLE_BUILD_FILE_SKIP_DIRS = new Set(['build', 'node_modules', '.gradle', '.git', '.idea']);
/** Bounds the readdir + per-module readFile cost on a project with many top-level directories. */
const MAX_GRADLE_BUILD_FILES = 50;

/**
 * Root `build.gradle(.kts)` plus every depth-1 subdirectory's own build
 * file, concatenated — verified against a real multi-module Android project
 * (spec 049) that plugin/framework declarations (`com.android.application`,
 * `androidx.compose`) commonly live in a *module's* build file, not the
 * root's; `readBuildGradle` alone (root only) is correct as the "is this
 * even a Gradle project?" signal but a false negative for framework
 * substring checks in a multi-module layout. Bounded to depth 1 and
 * `MAX_GRADLE_BUILD_FILES` — not a real Gradle DSL parse, no `include(...)`
 * awareness, same reduction this repo's other build-file readers already
 * make.
 */
export async function readGradleBuildFiles(projectPath: string): Promise<string | null> {
  const chunks: string[] = [];

  const root = await readBuildGradle(projectPath);
  if (root) chunks.push(root);

  let entries: Dirent[];
  try {
    entries = await readdir(projectPath, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (chunks.length - (root ? 1 : 0) >= MAX_GRADLE_BUILD_FILES) break;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || GRADLE_BUILD_FILE_SKIP_DIRS.has(entry.name)) continue;

    const moduleBuildFile = await readBuildGradle(join(projectPath, entry.name));
    if (moduleBuildFile) chunks.push(moduleBuildFile);
  }

  return chunks.length > 0 ? chunks.join('\n') : null;
}

export async function readDockerCompose(projectPath: string): Promise<string | null> {
  const paths = [
    'docker-compose.yml',
    'docker-compose.yaml',
  ];

  for (const fileName of paths) {
    const content = await readTextFile(join(projectPath, fileName));
    if (content) return content;
  }

  return null;
}

export async function readMakefile(projectPath: string): Promise<string | null> {
  return readTextFile(join(projectPath, 'Makefile'));
}

export async function readEnvExample(projectPath: string): Promise<string | null> {
  const paths = ['.env.example', '.env.sample', '.env.dist'];
  for (const fileName of paths) {
    const content = await readTextFile(join(projectPath, fileName));
    if (content) return content;
  }
  return null;
}

export async function readREADME(projectPath: string): Promise<string | null> {
  const paths = ['README.md', 'readme.md', 'README.txt', 'readme.txt'];
  for (const fileName of paths) {
    const content = await readTextFile(join(projectPath, fileName));
    if (content) return content;
  }
  return null;
}
