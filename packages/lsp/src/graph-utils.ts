import { fileURLToPath, pathToFileURL } from "url";
import { join, relative, sep } from "path";
import type { Graph, Node } from "@caiquebrito/nodum-core";
import { Position, Range, SymbolKind } from "vscode-languageserver/node";

// LSP has no dedicated kind for a few of nodum's NodeTypes (`protocol`,
// `extension` — both from the Swift/ObjC parsers, spec 036) — mapped to the
// closest existing SymbolKind rather than left unmapped, since every kind is
// required by the protocol.
const SYMBOL_KIND_BY_NODE_TYPE: Record<Node["type"], SymbolKind> = {
  file: SymbolKind.File,
  function: SymbolKind.Function,
  class: SymbolKind.Class,
  interface: SymbolKind.Interface,
  method: SymbolKind.Method,
  struct: SymbolKind.Struct,
  enum: SymbolKind.Enum,
  protocol: SymbolKind.Interface,
  extension: SymbolKind.Namespace,
};

export function symbolKindForNode(node: Node): SymbolKind {
  return SYMBOL_KIND_BY_NODE_TYPE[node.type] ?? SymbolKind.Object;
}

export function pathToUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString();
}

export function uriToPath(uri: string): string {
  return fileURLToPath(uri);
}

/** `Node.file` is project-root-relative (see `file-discovery.ts`); every LSP
 * URI needs the absolute path. */
export function nodeUri(rootPath: string, node: Node): string {
  return pathToUri(join(rootPath, node.file));
}

/** Inverse of `nodeUri`'s join — used to filter graph nodes down to the ones
 * belonging to a single open document. */
export function relativeFilePath(rootPath: string, uri: string): string {
  const relPath = relative(rootPath, uriToPath(uri));
  // Node.file always uses forward slashes (this project's convention across
  // every parser); `relative()` uses the platform separator.
  return relPath.split(sep).join("/");
}

/** `Node.line` is 1-indexed when present (typical parser convention); LSP
 * positions are 0-indexed. A node with no known line renders at the top of
 * its file rather than being omitted — still locatable, just imprecise. */
// LSP's `uinteger` wire type caps at 2^31-1 (`Is.uinteger` in
// vscode-languageserver-types validates against exactly this bound) —
// `Number.MAX_SAFE_INTEGER` overflows it and fails `Position.is()`.
const END_OF_LINE_CHARACTER = 2147483647;

export function nodeRange(node: Node): Range {
  const line = Math.max((node.line ?? 1) - 1, 0);
  // No end-column info is tracked per node, so the range spans the whole
  // line — a common LSP convention for "approximately here," which clients
  // clamp to the document's actual line length.
  return Range.create(Position.create(line, 0), Position.create(line, END_OF_LINE_CHARACTER));
}

export function nodeLine(node: Node): number {
  return Math.max((node.line ?? 1) - 1, 0);
}

/** Finds the node in `file` whose line is closest to (at or before)
 * `position`, among nodes with a known line — the same "nearest preceding
 * declaration" heuristic most line-based-only language tooling uses when no
 * real end-of-range is tracked. Falls back to the file node itself when no
 * finer-grained node has a line at or before the position. */
export function findNodeAtPosition(graph: Graph, file: string, position: Position): Node | undefined {
  const candidates = graph.nodes.filter((n) => n.file === file && n.type !== "file");
  let best: Node | undefined;
  let bestLine = -1;
  for (const node of candidates) {
    const line = nodeLine(node);
    if (line <= position.line && line > bestLine) {
      best = node;
      bestLine = line;
    }
  }
  if (best) return best;
  return graph.nodes.find((n) => n.file === file && n.type === "file");
}
