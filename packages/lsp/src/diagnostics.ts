import {
  detectArchitectureViolations,
  detectCycles,
  detectUnreachableFiles,
  findCiInvokedFiles,
  findManifestEntryFiles,
  loadArchitectureConfig,
  type Graph,
  type Node,
} from "@caiquebrito/nodum-core";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { nodeRange, nodeUri } from "./graph-utils.js";

/**
 * Cycles, dead code, and (opt-in) architecture violations as LSP
 * diagnostics, grouped by file URI — the "sleeper feature" spec 072's Design
 * section calls out: these findings already exist via
 * `nodum dead-code`/`nodum cycles`, this is a formatting layer turning them
 * into inline warnings with zero per-IDE code. All three at
 * `DiagnosticSeverity.Warning` — none represent a compile error.
 */
export async function computeDiagnostics(
  rootPath: string,
  graph: Graph,
): Promise<Map<string, Diagnostic[]>> {
  const byUri = new Map<string, Diagnostic[]>();
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  const push = (node: Node | undefined, message: string) => {
    if (!node) return;
    const uri = nodeUri(rootPath, node);
    const list = byUri.get(uri) ?? [];
    list.push({
      range: nodeRange(node),
      severity: DiagnosticSeverity.Warning,
      message,
      source: "nodum",
    });
    byUri.set(uri, list);
  };

  for (const cycle of detectCycles(graph)) {
    const cycleLabel = cycle.files.join(" → ");
    for (const nodeId of cycle.nodeIds) {
      push(nodesById.get(nodeId), `Circular import: ${cycleLabel}`);
    }
  }

  // Same entry-point resolution `suggestRefactoring` already uses
  // (AndroidManifest.xml components, CI/shell-invoked scripts) — reusing it
  // here means this diagnostic doesn't reintroduce the exact false
  // positives specs 061/062 just fixed.
  const [manifestEntryFiles, ciInvokedFiles] = await Promise.all([
    findManifestEntryFiles(rootPath, graph.nodes),
    findCiInvokedFiles(rootPath, graph.nodes),
  ]);
  const unreachable = detectUnreachableFiles(graph, {
    entryPatterns: [...manifestEntryFiles, ...ciInvokedFiles],
  });
  for (const file of unreachable) {
    push(nodesById.get(file.nodeId), `Unreachable file — no other file imports ${file.file}`);
  }

  // Opt-in via .nodumrc.json, same as suggestRefactoring — no rules means no
  // architecture is declared, not that everything passes.
  const { rules } = await loadArchitectureConfig(rootPath);
  if (rules && rules.length > 0) {
    for (const violation of detectArchitectureViolations(graph, rules)) {
      const source = nodesById.get(violation.sourceNodeId);
      push(
        source,
        `Architecture violation: ${violation.sourceFile} (${source?.group ?? "?"}) imports ${violation.targetFile} (${nodesById.get(violation.targetNodeId)?.group ?? "?"})`,
      );
    }
  }

  return byUri;
}
