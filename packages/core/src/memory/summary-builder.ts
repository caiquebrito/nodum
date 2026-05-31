import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Graph, ProjectAnalysis } from '../types.js';

export async function buildAndWriteSummary(
  memoryDir: string,
  graph: Graph,
  analysis: ProjectAnalysis,
): Promise<void> {
  const summaryPath = join(memoryDir, 'SUMMARY.md');

  const content = buildSummaryContent(graph, analysis);

  try {
    await mkdir(memoryDir, { recursive: true });

    // Check if existing summary exists and preserve manual sections
    let finalContent = content;
    try {
      const existing = await readFile(summaryPath, 'utf-8');

      // Extract manual sections (Notes, Dependencies On, Exposes To)
      const manualStart = existing.indexOf('## Manual Notes');
      if (manualStart > -1) {
        const manualContent = existing.substring(manualStart);
        finalContent = content + '\n\n' + manualContent;
      }
    } catch {
      // File doesn't exist, that's ok
    }

    await writeFile(summaryPath, finalContent, 'utf-8');
  } catch {
    // Silently fail if we can't write summary
  }
}

function buildSummaryContent(graph: Graph, analysis: ProjectAnalysis): string {
  const now = new Date();
  const lastSync = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return `# ${graph.project} — Project Summary

**Last synced**: ${lastSync}

## Overview

${analysis.description || 'A project tracked with nodum.'}

## Stack

- **Languages**: ${analysis.languages.join(', ') || 'Not detected'}
- **Frameworks**: ${analysis.frameworks.join(', ') || 'None detected'}
- **Databases**: ${analysis.databases.join(', ') || 'None detected'}
- **Runtimes**: ${analysis.runtimes.join(', ') || 'None detected'}
- **Build Tools**: ${analysis.buildTools.join(', ') || 'None detected'}
- **Test Frameworks**: ${analysis.testFrameworks.join(', ') || 'None detected'}

## Code Stats

- **Files**: ${graph.stats.files}
- **Functions**: ${graph.stats.functions}
- **Classes**: ${graph.stats.classes}
- **Interfaces**: ${graph.stats.interfaces}
- **Dependencies**: ${graph.stats.edges}

## Environment Variables

${
  analysis.envVariables && Object.keys(analysis.envVariables).length > 0
    ? Object.entries(analysis.envVariables)
        .map(([key, value]) => `- \`${key}\` = \`${value || '(required)'}\``)
        .join('\n')
    : 'None detected'
}

## Architecture Notes

### Dependencies On
(What external projects or services this depends on)

### Exposes To
(What other projects depend on this)

### Notes
(Custom architectural notes)
`;
}
