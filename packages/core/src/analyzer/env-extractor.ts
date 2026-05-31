import { readEnvExample } from './config-reader.js';

export interface EnvVariable {
  name: string;
  default?: string;
  description?: string;
}

export async function extractEnvironmentVariables(projectPath: string): Promise<Record<string, string>> {
  const envContent = await readEnvExample(projectPath);
  if (!envContent) return {};

  const envVars: Record<string, string> = {};
  const lines = envContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [key, ...rest] = trimmed.split('=');
    if (key) {
      const cleanKey = key.trim();
      const value = rest.join('=').trim();
      envVars[cleanKey] = value || '';
    }
  }

  return envVars;
}
