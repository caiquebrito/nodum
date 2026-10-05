/**
 * `nodum note`/`nodum notes` (spec 082) — a cheap, fully local,
 * cross-session decision log. `appendDecisionLog`/`readDecisionLog` do the
 * actual read/write (capped at `MAX_DECISION_ENTRIES`); this file is the
 * CLI-shaped wrapper, mirroring `metrics.ts`'s project-name resolution and
 * read-command conventions exactly.
 */
import { join, resolve, basename } from 'path';
import { appendDecisionLog, readDecisionLog, injectLatestNote } from '@caiquebrito/nodum-core';

export async function noteCommand(message: string, projectPath: string, nodumDataDir: string): Promise<void> {
  const absolutePath = resolve(projectPath);
  const projectName = basename(absolutePath);
  const memoryDir = join(nodumDataDir, projectName, 'memory');

  await appendDecisionLog(memoryDir, message);
  const [latest] = await readDecisionLog(memoryDir, 1);
  await injectLatestNote(absolutePath, memoryDir, latest);

  console.log(`📝 Noted for "${projectName}".`);
}

export interface NotesCommandOptions {
  limit?: number;
  json?: boolean;
}

export async function notesCommand(
  projectPath: string,
  nodumDataDir: string,
  options: NotesCommandOptions = {},
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const memoryDir = join(nodumDataDir, projectName, 'memory');
  const limit = options.limit ?? 10;
  const entries = await readDecisionLog(memoryDir, limit);

  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(`No notes recorded yet for "${projectName}". Add one with: nodum note "<message>"`);
    return;
  }

  console.log(`\n📝 Recent notes — ${projectName}\n`);
  for (const entry of entries) {
    console.log(`- **${entry.timestamp}**: ${entry.text}`);
  }
  console.log('');
}
