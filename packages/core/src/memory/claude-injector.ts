import { readFile, writeFile } from 'fs/promises';
import type { Graph, ProjectAnalysis } from '../types.js';
import type { DecisionEntry } from './decision-log.js';

const MARKER_START = '<!-- nodum:start -->';
const MARKER_END = '<!-- nodum:end -->';

const NOTES_MARKER_START = '<!-- nodum:notes:start -->';
const NOTES_MARKER_END = '<!-- nodum:notes:end -->';

/**
 * Replaces the block between `markerStart`/`markerEnd` in `claudePath` with
 * `block` (which itself already includes both markers), or prepends it if
 * those markers aren't present yet. Shared by `injectCLAUDEContext` (spec
 * 002's sync-stats block) and `injectLatestNote` (spec 082's independent
 * notes block) — the two marker pairs never overlap, so updating one never
 * touches the other's content.
 */
async function upsertMarkerBlock(
  claudePath: string,
  markerStart: string,
  markerEnd: string,
  block: string,
): Promise<void> {
  try {
    const existing = await readFile(claudePath, 'utf-8');

    if (existing.includes(markerStart) && existing.includes(markerEnd)) {
      // Replace everything from the first start marker to the last end
      // marker — also collapses any previously duplicated marker pairs
      // back into a single clean block.
      const startIdx = existing.indexOf(markerStart);
      const endIdx = existing.lastIndexOf(markerEnd) + markerEnd.length;
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx);
      await writeFile(claudePath, `${before}${block}${after}`, 'utf-8');
    } else {
      // Append markers + block at the beginning
      await writeFile(claudePath, `${block}\n\n${existing}`, 'utf-8');
    }
  } catch {
    // File doesn't exist, create it
    await writeFile(claudePath, block, 'utf-8');
  }
}

export async function injectCLAUDEContext(
  projectPath: string,
  graph: Graph,
  analysis: ProjectAnalysis,
): Promise<void> {
  const claudePath = `${projectPath}/CLAUDE.md`;
  await upsertMarkerBlock(claudePath, MARKER_START, MARKER_END, buildContextBlock(graph, analysis));
}

/**
 * Updates the project's `CLAUDE.md` with only the single most recent
 * decision-log entry (spec 082) — never the full history, and independent
 * of `injectCLAUDEContext`'s sync-stats block (a different marker pair), so
 * a note surfaces immediately without waiting for the next `nodum sync`,
 * and a sync never clobbers it. Deliberately a pointer, not a dump: keeping
 * the injected cost near-constant regardless of how many notes have
 * accumulated on disk is this feature's whole reason to exist (see spec
 * 082's Design).
 */
export async function injectLatestNote(
  projectPath: string,
  memoryPath: string,
  latest: DecisionEntry | undefined,
): Promise<void> {
  if (!latest) return;
  const claudePath = `${projectPath}/CLAUDE.md`;
  const block = `${NOTES_MARKER_START}
## Recent Note — Nodum

**${latest.timestamp}**: ${latest.text}

Full history: \`${memoryPath}/DECISIONS.md\` (or run \`nodum notes\`).
${NOTES_MARKER_END}`;
  await upsertMarkerBlock(claudePath, NOTES_MARKER_START, NOTES_MARKER_END, block);
}

function buildContextBlock(graph: Graph, analysis: ProjectAnalysis): string {
  const stack = [
    ...analysis.languages,
    ...analysis.frameworks,
    ...analysis.runtimes,
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5).join(' · ');

  const now = new Date();
  const lastSync = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return `${MARKER_START}
## Knowledge Graph Context — Nodum

**Load this before each response.** Stack: **${stack || 'unknown'}** | Files: **${graph.stats.files}** | Functions: **${graph.stats.functions}** | Last sync: **${lastSync}**

Analyze code with this project's structure in mind. Reference the knowledge graph when answering questions about code organization, dependencies, or implementation patterns.
${MARKER_END}`;
}
