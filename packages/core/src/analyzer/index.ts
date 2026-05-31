import type { ProjectAnalysis } from '../types.js';
import { detectStack } from './stack-detector.js';
import { extractEnvironmentVariables } from './env-extractor.js';

export type { EnvVariable } from './env-extractor.js';
export { extractEnvironmentVariables } from './env-extractor.js';
export { detectStack } from './stack-detector.js';

export async function analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
  const stack = await detectStack(projectPath);
  const envVars = await extractEnvironmentVariables(projectPath);

  return {
    ...stack,
    envVariables: envVars,
  };
}
