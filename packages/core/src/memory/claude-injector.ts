import { readFile, writeFile } from 'fs/promises';
import type { Graph, ProjectAnalysis } from '../types.js';

const MARKER_START = '<!-- nodum:start -->';
const MARKER_END = '<!-- nodum:end -->';

export async function injectCLAUDEContext(
  projectPath: string,
  graph: Graph,
  analysis: ProjectAnalysis,
): Promise<void> {
  const claudePath = `${projectPath}/CLAUDE.md`;

  // Build context block
  const contextBlock = buildContextBlock(graph, analysis);

  try {
    // Try to read existing CLAUDE.md
    const existing = await readFile(claudePath, 'utf-8');

    // Check if markers already exist
    if (existing.includes(MARKER_START) && existing.includes(MARKER_END)) {
      // Replace everything from the first start marker to the last end marker.
      // contextBlock already includes both markers, so we slice them out of the
      // surrounding text. Using first-start/last-end also collapses any
      // previously duplicated marker pairs back into a single clean block.
      const startIdx = existing.indexOf(MARKER_START);
      const endIdx = existing.lastIndexOf(MARKER_END) + MARKER_END.length;
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx);
      const updated = `${before}${contextBlock}${after}`;
      await writeFile(claudePath, updated, 'utf-8');
    } else {
      // Append markers + context at the beginning
      const updated = `${contextBlock}\n\n${existing}`;
      await writeFile(claudePath, updated, 'utf-8');
    }
  } catch {
    // File doesn't exist, create it
    const contextBlock = buildContextBlock(graph, analysis);
    await writeFile(claudePath, contextBlock, 'utf-8');
  }
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
