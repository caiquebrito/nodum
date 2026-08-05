import type { Graph } from "@caiquebrito/nodum-core";
import { DocumentSymbol, Location, SymbolInformation } from "vscode-languageserver/node";
import { nodeRange, nodeUri, relativeFilePath, symbolKindForNode } from "./graph-utils.js";

// Mirrors findRelevantNodes' `40` in smart-context.ts (spec 027's bound-
// expansion precedent) — a workspace-wide symbol picker with no cap could
// dump thousands of results into the client's quick-pick UI on a large graph.
const MAX_WORKSPACE_SYMBOL_RESULTS = 100;

export function workspaceSymbols(rootPath: string, graph: Graph, query: string): SymbolInformation[] {
  const q = query.trim().toLowerCase();
  return graph.nodes
    .filter((n) => n.type !== "file")
    .filter((n) => q.length === 0 || n.label.toLowerCase().includes(q))
    .slice(0, MAX_WORKSPACE_SYMBOL_RESULTS)
    .map((node) => ({
      name: node.label,
      kind: symbolKindForNode(node),
      location: Location.create(nodeUri(rootPath, node), nodeRange(node)),
      containerName: node.file,
    }));
}

export function documentSymbols(rootPath: string, graph: Graph, uri: string): DocumentSymbol[] {
  const file = relativeFilePath(rootPath, uri);
  return graph.nodes
    .filter((n) => n.file === file && n.type !== "file")
    .map((node) => {
      const range = nodeRange(node);
      return DocumentSymbol.create(node.label, undefined, symbolKindForNode(node), range, range);
    });
}
