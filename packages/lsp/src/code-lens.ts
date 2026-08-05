import type { Graph } from "@caiquebrito/nodum-core";
import { CodeLens } from "vscode-languageserver/node";
import { nodeRange, relativeFilePath } from "./graph-utils.js";

// File nodes get their own dead-code/cycle diagnostics already — a code lens
// per declaration, not per file.
const LENS_NODE_TYPES = new Set(["function", "method", "class", "struct", "enum", "protocol", "interface"]);

/** "N dependents · complexity X", clickable straight into `nodum.traceImpact`
 * for that declaration — the codeLens/traceImpact pairing spec 072's Scope
 * table calls out. */
export function codeLensesForFile(rootPath: string, graph: Graph, uri: string): CodeLens[] {
  const file = relativeFilePath(rootPath, uri);

  const fanIn = new Map<string, number>();
  for (const edge of graph.edges) {
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  }

  return graph.nodes
    .filter((n) => n.file === file && LENS_NODE_TYPES.has(n.type))
    .map((node) => {
      const dependents = fanIn.get(node.id) ?? 0;
      const titleParts = [`${dependents} dependent${dependents === 1 ? "" : "s"}`];
      if (node.complexity !== undefined) titleParts.push(`complexity ${node.complexity}`);

      const lens = CodeLens.create(nodeRange(node));
      lens.command = {
        title: titleParts.join(" · "),
        command: "nodum.traceImpact",
        arguments: [node.id],
      };
      return lens;
    });
}
