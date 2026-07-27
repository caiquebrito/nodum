import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface ArchitectureRule {
  /** Node group, or '*' for "any group". */
  from: string;
  to: string;
}

export interface ArchitectureConfig {
  rules?: ArchitectureRule[];
}

const CONFIG_FILENAME = '.nodumrc.json';

export async function loadArchitectureConfig(rootPath: string): Promise<ArchitectureConfig> {
  try {
    const content = await readFile(join(rootPath, CONFIG_FILENAME), 'utf-8');
    const parsed = JSON.parse(content);
    return { rules: Array.isArray(parsed.architecture?.rules) ? parsed.architecture.rules : undefined };
  } catch {
    return {};
  }
}

/**
 * Merges into the raw JSON object rather than round-tripping through a typed
 * shape, so unrelated top-level keys already in the file (e.g. `include`/
 * `exclude`, from `scan-config.ts`) survive untouched.
 */
export async function saveArchitectureConfig(rootPath: string, update: ArchitectureConfig): Promise<void> {
  const path = join(rootPath, CONFIG_FILENAME);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    // No existing file — start fresh.
  }
  if (update.rules !== undefined) {
    raw.architecture = { ...(raw.architecture as object | undefined), rules: update.rules };
  }
  await writeFile(path, JSON.stringify(raw, null, 2), 'utf-8');
}
