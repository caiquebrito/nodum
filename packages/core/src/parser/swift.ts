import type { ParseResult, FileInfo, Node, Edge, NodeType } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveSwiftImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';

// Verified empirically (spec 037): `class`/`struct`/`enum`/`actor`/`extension`
// all parse as one `class_declaration` node type — there is no dedicated
// `struct_declaration`/`enum_declaration`/`extension_declaration`. `protocol`
// is the one exception, a real `protocol_declaration` node. One combined
// query captures both shapes; `swiftDeclKind()` below disambiguates the
// `class_declaration` matches by keyword token.
const TYPE_QUERY = `
  (class_declaration name: (_) @name) @def
  (protocol_declaration name: (type_identifier) @name) @def
`;

// Real decision points via actual AST node types. `switch_entry` covers both
// `case` and a bare `default:` — excluded via `isDefaultSwitchEntry()` below,
// matching every other parser here's posture that a bare default label isn't
// its own decision point. No `binary_expression`/operator-field check is
// needed for `&&`/`||`, unlike Java/JS — this grammar has dedicated
// `conjunction_expression`/`disjunction_expression` node types.
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'guard_statement',
  'switch_entry',
  'ternary_expression',
  'catch_block',
  'do_statement',
  'nil_coalescing_expression',
  'conjunction_expression',
  'disjunction_expression',
]);

const LITERAL_NODE_TYPES = new Set([
  'integer_literal',
  'real_literal',
  'boolean_literal',
  'line_string_literal',
  'nil',
]);

// Direct child names, in order, whose presence disambiguates a
// `class_declaration` match into the real NodeType. `modifiers` (e.g.
// `final`) can precede the keyword token, so this can't assume `child(0)`.
const CLASS_DECL_KEYWORDS: Record<string, NodeType> = {
  class: 'class',
  struct: 'struct',
  enum: 'enum',
  actor: 'class', // no dedicated NodeType for an actor; closest existing semantic
  extension: 'extension',
};

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class SwiftParser extends TreeSitterParser {
  language = 'Swift';
  extensions = ['.swift'];
  // `.build`/`.swiftpm` are already skipped by file-discovery.ts's existing
  // hidden-file rule (any dot-prefixed directory). DerivedData/Pods/Carthage
  // are not dot-prefixed, so they need to be named explicitly.
  ignoredDirs = ['DerivedData', 'Pods', 'Carthage'];
  protected grammarFile = 'tree-sitter-swift.wasm';

  resolveImport(specifier: string, importingFilePath: string, knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[] {
    return resolveSwiftImport(specifier, importingFilePath, knownFileIds, knownFilesByPath);
  }

  async parse(file: FileInfo): Promise<ParseResult> {
    const { parser, language } = await this.ensureReady();
    const tree = parser.parse(file.content);
    const root = tree!.rootNode;

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const callables: CallableUnit[] = [];

    const fileId = normalizeNodeId(file.path, file.path, 'file');
    nodes.push({
      id: fileId,
      label: file.path.split('/').pop() || file.path,
      type: 'file',
      file: file.path,
      group: getNodeGroup(file.path),
    });

    // Types: class/struct/enum/actor/extension (one grammar node,
    // disambiguated below) plus protocol (its own node type). Every
    // declaration, at any depth, gets a flat fileId->id edge — same
    // precedent as every other parser here. Each one's own direct members
    // are then attributed to it.
    const seenTypeNames = new Set<string>();
    const typeQuery = getQuery(language, 'swift-types', TYPE_QUERY);
    for (const match of typeQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;

      const kind: NodeType | null =
        defNode.type === 'protocol_declaration' ? 'protocol' : swiftDeclKind(defNode);
      if (!kind) continue; // an unrecognized class_declaration keyword shape — skip rather than mis-tag

      const typeName = nameNode.text;
      // An extension's id is namespaced (`${typeName}+ext`) so it doesn't
      // collide with a same-file `class`/`struct` of the same name — the
      // flat name-based id scheme (`normalizeNodeId`) ignores NodeType, so
      // `class Foo` and `extension Foo` would otherwise produce the same id.
      const idName = kind === 'extension' ? `${typeName}+ext` : typeName;
      const dedupeKey = `${kind}:${idName}`;
      if (seenTypeNames.has(dedupeKey)) continue; // first-wins on a collision (e.g. two extensions of the same type)
      seenTypeNames.add(dedupeKey);

      const typeId = normalizeNodeId(file.path, idName, kind);
      nodes.push({
        id: typeId,
        label: kind === 'extension' ? `${typeName} (extension)` : typeName,
        type: kind,
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
      });
      edges.push({ source: fileId, target: typeId, relation: 'defines' });

      const body = defNode.childForFieldName('body');
      if (!body) continue;

      const seenMemberNames = new Set<string>();
      for (const child of body.namedChildren) {
        if (!child) continue;

        let memberName: string;
        let memberBody: TSNode | null;
        if (child.type === 'function_declaration') {
          memberName = child.childForFieldName('name')?.text ?? 'method';
          memberBody = child.childForFieldName('body');
        } else if (child.type === 'init_declaration') {
          memberName = 'init';
          memberBody = child.childForFieldName('body');
        } else if (child.type === 'deinit_declaration') {
          memberName = 'deinit';
          memberBody = child.childForFieldName('body');
        } else if (child.type === 'protocol_function_declaration') {
          memberName = child.childForFieldName('name')?.text ?? 'method';
          memberBody = null; // protocol requirements have no body
        } else {
          continue;
        }

        if (seenMemberNames.has(memberName)) continue; // first overload wins — same posture as every other parser here
        seenMemberNames.add(memberName);

        const duplicateHash = memberBody ? hashTokens(collectNormalizedTokens(memberBody)) : null;
        const methodId = normalizeNodeId(file.path, `${idName}#${memberName}`, 'method');
        nodes.push({
          id: methodId,
          label: memberName,
          type: 'method',
          file: file.path,
          group: getNodeGroup(file.path),
          line: child.startPosition.row + 1,
          ...(memberBody ? { complexity: computeComplexity(memberBody) } : {}),
          ...(duplicateHash ? { duplicateHash } : {}),
        });
        edges.push({ source: typeId, target: methodId, relation: 'defines' });
        if (memberBody) callables.push({ nodeId: methodId, name: memberName, body: memberBody });
      }
    }

    // Top-level functions — found by iterating root's own named children,
    // not by query. Deliberate scope reduction: a *local* function nested
    // inside another function's body (Swift allows this) is not extracted
    // as its own node — only module-scope functions and type members are.
    // A function_declaration nested inside a type was already consumed
    // above; this pass only sees module-scope declarations.
    const seenFunctionNames = new Set<string>();
    for (const child of root.namedChildren) {
      if (!child || child.type !== 'function_declaration') continue;

      const name = child.childForFieldName('name')?.text ?? 'anonymous';
      if (seenFunctionNames.has(name)) continue;
      seenFunctionNames.add(name);

      const funcId = normalizeNodeId(file.path, name, 'function');
      const body = child.childForFieldName('body');
      const duplicateHash = body ? hashTokens(collectNormalizedTokens(body)) : null;
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: file.path,
        group: getNodeGroup(file.path),
        line: child.startPosition.row + 1,
        ...(body ? { complexity: computeComplexity(body) } : {}),
        ...(duplicateHash ? { duplicateHash } : {}),
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
      if (body) callables.push({ nodeId: funcId, name, body });
    }

    extractCalls(callables, edges);

    const imports = extractImports(root);

    return { nodes, edges, imports };
  }
}

/**
 * Disambiguates a `class_declaration` match by scanning its direct children
 * for the first keyword token that identifies it (`class`/`struct`/`enum`/
 * `actor`/`extension`) — not always `child(0)`, since an optional
 * `modifiers` node (e.g. `final`) can precede it.
 */
function swiftDeclKind(defNode: TSNode): NodeType | null {
  for (let i = 0; i < defNode.childCount; i++) {
    const child = defNode.child(i);
    if (!child) continue;
    const kind = CLASS_DECL_KEYWORDS[child.type];
    if (kind) return kind;
  }
  return null;
}

function isDefaultSwitchEntry(node: TSNode): boolean {
  return node.namedChild(0)?.type === 'default_keyword';
}

/**
 * McCabe cyclomatic complexity, walking `bodyNode`'s subtree. Same
 * traversal boundary as every other parser here: doesn't descend into a
 * nested function/method definition (separately scored).
 */
function computeComplexity(bodyNode: TSNode): number {
  let complexity = 1;

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (node.type === 'switch_entry' && isDefaultSwitchEntry(node)) {
      // a bare `default:` isn't its own decision point — matches every
      // other parser's `switch`/`case` posture
    } else if (COMPLEXITY_NODE_TYPES.has(node.type)) {
      complexity++;
    }
    if (node.type === 'function_declaration' || node.type === 'init_declaration' || node.type === 'deinit_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return complexity;
}

/**
 * Normalized structural token stream for duplication detection. Same
 * ID/LIT/node-type-name scheme as the other tree-sitter parsers here.
 */
function collectNormalizedTokens(bodyNode: TSNode): string[] {
  const tokens: string[] = [];

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (node.type === 'simple_identifier') {
      tokens.push('ID');
      return;
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      tokens.push('LIT');
      return;
    }

    tokens.push(node.type);

    if (node.type === 'function_declaration' || node.type === 'init_declaration' || node.type === 'deinit_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

/**
 * Same-file `calls` edges (spec 034), applied to Swift (spec 037). Only
 * bare-identifier calls (`foo()`) resolve — `self.foo()` (a
 * `navigation_expression` first child, not a plain `simple_identifier`) is
 * deliberately left alone, same posture as every other parser's qualified-
 * call exclusion. First-definition-wins on a name collision.
 */
function extractCalls(callables: CallableUnit[], edges: Edge[]): void {
  if (callables.length === 0) return;

  const nameToNodeId = new Map<string, string>();
  for (const { name, nodeId } of callables) {
    if (!nameToNodeId.has(name)) nameToNodeId.set(name, nodeId);
  }

  for (const { nodeId, body } of callables) {
    const calledIds = new Set<string>();

    function visit(node: TSNode | null): void {
      if (!node) return;
      if (node.type === 'call_expression') {
        const callee = node.namedChild(0);
        if (callee?.type === 'simple_identifier') {
          const targetId = nameToNodeId.get(callee.text);
          if (targetId) calledIds.add(targetId);
        }
      }
      if (node.type === 'function_declaration' || node.type === 'init_declaration' || node.type === 'deinit_declaration') return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

/**
 * `import Foundation` / `import UIKit.UIView` / `@testable import M` all
 * share one `import_declaration` node with an `identifier` child whose
 * `.text` is the full dotted module path (verified empirically — spec 037).
 */
function extractImports(root: TSNode): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  for (const importDecl of root.descendantsOfType('import_declaration')) {
    if (!importDecl) continue;
    const idNode = importDecl.namedChildren.find(c => c?.type === 'identifier');
    const specifier = idNode?.text;
    if (specifier && !seen.has(specifier)) {
      imports.push(specifier);
      seen.add(specifier);
    }
  }

  return imports;
}

export default new SwiftParser();
