import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Graph } from '../types.js';

export async function appendActivityLog(
  logsDir: string,
  graph: Graph,
): Promise<void> {
  const activityPath = join(logsDir, 'activity.md');

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const entry = `- **${timestamp}**: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n`;

  try {
    // Create dir if it doesn't exist
    await mkdir(logsDir, { recursive: true });

    // Try to append to existing log
    try {
      const existing = await readFile(activityPath, 'utf-8');
      await writeFile(activityPath, entry + existing, 'utf-8');
    } catch {
      // Create new log file
      await writeFile(activityPath, `# Activity Log\n\n${entry}`, 'utf-8');
    }
  } catch {
    // Silently fail if we can't write logs
  }
}
