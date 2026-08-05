import type { Graph } from "@caiquebrito/nodum-core";
import { Location, Position } from "vscode-languageserver/node";
import { findNodeAtPosition, nodeRange, nodeUri, relativeFilePath } from "./graph-utils.js";

/** The reversed direction of `handleGetDeps(..., "incoming")` (spec 072's
 * Scope table) — every node whose `calls`/`imports` edge targets the symbol
 * at `position`, i.e. "what references this," cross-file. */
export function referencesAt(
  rootPath: string,
  graph: Graph,
  uri: string,
  position: Position,
  includeDeclaration: boolean,
): Location[] {
  const file = relativeFilePath(rootPath, uri);
  const node = findNodeAtPosition(graph, file, position);
  if (!node) return [];

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const locations: Location[] = [];

  if (includeDeclaration) {
    locations.push(Location.create(nodeUri(rootPath, node), nodeRange(node)));
  }

  for (const edge of graph.edges) {
    if (edge.target !== node.id) continue;
    const source = nodesById.get(edge.source);
    if (!source) continue;
    locations.push(Location.create(nodeUri(rootPath, source), nodeRange(source)));
  }

  return locations;
}
