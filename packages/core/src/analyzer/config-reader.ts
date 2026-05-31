import { readFile, access } from 'fs/promises';
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

export async function readBuildGradle(projectPath: string): Promise<string | null> {
  return readTextFile(join(projectPath, 'build.gradle'));
}

export async function readSettingsGradle(projectPath: string): Promise<string | null> {
  return readTextFile(join(projectPath, 'settings.gradle'));
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
