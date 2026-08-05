import {
  detectUnreachableFiles,
  findCiInvokedFiles,
  findManifestEntryFiles,
} from "@caiquebrito/nodum-core";
import { handleFindSimilarCode, handleTraceImpact } from "@caiquebrito/nodum-query";
import type { ProjectContext } from "./project.js";

export const NODUM_COMMANDS = [
  "nodum.sync",
  "nodum.traceImpact",
  "nodum.findSimilar",
  "nodum.deadCode",
] as const;

/** `workspace/executeCommand` is the one write-adjacent LSP surface this
 * spec implements — triggering sync/analysis, never editing code (nodum
 * stays a read-only knowledge layer; see spec 072's Out of scope note). */
export async function executeNodumCommand(
  command: string,
  args: unknown[],
  project: ProjectContext,
): Promise<string> {
  switch (command) {
    case "nodum.sync": {
      const graph = await project.resync();
      return `Synced ${project.projectName}: ${graph.stats.files} files, ${graph.stats.edges} dependencies`;
    }
    case "nodum.traceImpact": {
      const nodeId = String(args[0] ?? "");
      const result = await handleTraceImpact(project.projectName, nodeId);
      return result.content[0]?.text ?? "";
    }
    case "nodum.findSimilar": {
      const nodeId = String(args[0] ?? "");
      const result = await handleFindSimilarCode(project.projectName, nodeId);
      return result.content[0]?.text ?? "";
    }
    case "nodum.deadCode": {
      const graph = await project.ensureGraph();
      const [manifestEntryFiles, ciInvokedFiles] = await Promise.all([
        findManifestEntryFiles(project.rootPath, graph.nodes),
        findCiInvokedFiles(project.rootPath, graph.nodes),
      ]);
      const unreachable = detectUnreachableFiles(graph, {
        entryPatterns: [...manifestEntryFiles, ...ciInvokedFiles],
      });
      if (unreachable.length === 0) return "No dead code found";
      return `${unreachable.length} unreachable file(s):\n${unreachable
        .map((f) => `  • ${f.file}`)
        .join("\n")}`;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
