import type { Graph } from "@caiquebrito/nodum-core";
import { handleGetNode } from "@caiquebrito/nodum-query";
import { Hover, MarkupKind, Position } from "vscode-languageserver/node";
import { findNodeAtPosition, nodeRange, relativeFilePath } from "./graph-utils.js";

/** Reuses `handleGetNode` (spec 071's `buildNodeContext` under an MCP
 * text-result wrapper) rather than re-deriving the same summary text —
 * `buildNodeContext`'s output (label, type, file, dependencies, used-by) is
 * already exactly what a hover card wants. */
export async function hoverAt(
  projectName: string,
  rootPath: string,
  graph: Graph,
  uri: string,
  position: Position,
): Promise<Hover | null> {
  const file = relativeFilePath(rootPath, uri);
  const node = findNodeAtPosition(graph, file, position);
  if (!node) return null;

  const result = await handleGetNode(projectName, node.id);
  const value = result.content[0]?.text ?? node.label;

  return {
    contents: { kind: MarkupKind.PlainText, value },
    range: nodeRange(node),
  };
}
