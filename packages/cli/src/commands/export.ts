import { resolve, basename } from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { Graph } from '@caiquebrito/nodum-core';
import { toJSON, toGraphML, toCSV } from '../export-formats.js';

export type ExportFormat = 'json' | 'graphml' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  output?: string;
}

export async function exportGraph(
  projectPath: string,
  nodumDataDir: string,
  options: ExportOptions,
): Promise<void> {
  const projectName = basename(resolve(projectPath));
  const graphPath = `${nodumDataDir}/${projectName}/graph/graph.json`;

  let graph: Graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf-8'));
  } catch {
    throw new Error(`No synced graph found for "${projectName}". Run \`nodum sync\` first.`);
  }

  switch (options.format) {
    case 'json': {
      const out = options.output ?? `${projectName}.graph.json`;
      await writeFile(out, toJSON(graph), 'utf-8');
      console.log(`✅ Exported JSON: ${out}`);
      break;
    }
    case 'graphml': {
      const out = options.output ?? `${projectName}.graphml`;
      await writeFile(out, toGraphML(graph), 'utf-8');
      console.log(`✅ Exported GraphML: ${out}`);
      break;
    }
    case 'csv': {
      const base = options.output ?? projectName;
      const { nodesCsv, edgesCsv } = toCSV(graph);
      await writeFile(`${base}.nodes.csv`, nodesCsv, 'utf-8');
      await writeFile(`${base}.edges.csv`, edgesCsv, 'utf-8');
      console.log(`✅ Exported CSV: ${base}.nodes.csv, ${base}.edges.csv`);
      break;
    }
    default:
      throw new Error(`Unknown export format: "${options.format}". Use json, graphml, or csv.`);
  }
}
