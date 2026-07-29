import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { buildDuplicateSignals } from './duplicate-hash.js';
import { resolveGoImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';
import { computeCognitiveComplexity, type CognitiveConfig } from './cognitive-complexity.js';

// See cognitive-complexity.ts's CognitiveConfig doc comment. Same
// switch/type-switch/select-case exclusion as spec 045's design overall
// (not scored at all in this implementation — see that module's doc
// comment for why).
const GO_COGNITIVE_CONFIG: CognitiveConfig = {
  nesting: new Set(['if_statement', 'for_statement']),
  nestingOnly: new Set(['func_literal']),
  boundary: new Set(['function_declaration', 'method_declaration']),
  isBooleanOp: node => {
    if (node.type !== 'binary_expression') return false;
    const op = node.childForFieldName('operator')?.text;
    return op === '&&' || op === '||';
  },
  calleeName: node => {
    if (node.type !== 'call_expression') return null;
    const fn = node.childForFieldName('function');
    return fn?.type === 'identifier' ? fn.text : null;
  },
};

const TYPE_QUERY = '(type_declaration (type_spec name: (type_identifier) @name type: (_) @kind)) @def';
const FUNCTION_QUERY = '(function_declaration name: (identifier) @name body: (block) @body) @def';
const METHOD_QUERY =
  '(method_declaration receiver: (parameter_list) @recv name: (field_identifier) @name body: (block) @body) @def';

// `default_case` deliberately excluded, matching every other parser's
// default-branch posture (e.g. swift.ts's isDefaultSwitchEntry). Go has no
// ternary/while/do/elif — `else if` nests as a plain child if_statement
// inside the else-branch block, so it's counted the same as any other `if`
// (verified empirically; no special-casing needed at the cyclomatic level).
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'for_statement', // Go's only loop construct (for/for-cond/for-range all share this node type)
  'expression_case', // switch
  'type_case', // type switch
  'communication_case', // select
]);

const LITERAL_NODE_TYPES = new Set([
  'int_literal',
  'float_literal',
  'imaginary_literal',
  'rune_literal',
  'interpreted_string_literal',
  'raw_string_literal',
  'true',
  'false',
  'nil',
]);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class GoParser extends TreeSitterParser {
  language = 'Go';
  extensions = ['.go'];
  ignoredDirs = ['vendor'];
  protected grammarFile = 'tree-sitter-go.wasm';

  resolveImport(
    specifier: string,
    importingFilePath: string,
    knownFileIds: Set<string>,
    knownFilesByPath: Map<string, string>,
  ): string[] {
    return resolveGoImport(specifier, importingFilePath, knownFileIds, knownFilesByPath);
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

    // Types first, so methods (a separate pass below — Go methods are
    // *siblings* of their type, not nested in its body) can attribute
    // themselves via a name lookup rather than body traversal.
    const typeIdsByName = new Map<string, string>();
    const seenTypeNames = new Set<string>();
    const typeQuery = getQuery(language, 'go-types', TYPE_QUERY);
    for (const match of typeQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      const kindNode = match.captures.find(c => c.name === 'kind')?.node;
      if (!defNode || !nameNode || !kindNode) continue;

      // Only struct/interface become nodes here — a plain alias/defined
      // type (`type Celsius float64`, `type Fn func()`) is deliberately
      // skipped, not mis-tagged as a class/struct, matching swiftDeclKind's
      // "return null rather than guess" posture for unrecognized shapes.
      const kind = kindNode.type === 'struct_type' ? 'struct' : kindNode.type === 'interface_type' ? 'interface' : null;
      if (!kind) continue;

      const typeName = nameNode.text;
      if (seenTypeNames.has(typeName)) continue;
      seenTypeNames.add(typeName);

      const typeId = normalizeNodeId(file.path, typeName, kind);
      typeIdsByName.set(typeName, typeId);
      nodes.push({
        id: typeId,
        label: typeName,
        type: kind,
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
      });
      edges.push({ source: fileId, target: typeId, relation: 'defines' });
    }

    const seenMethodKeys = new Set<string>();
    const methodQuery = getQuery(language, 'go-methods', METHOD_QUERY);
    for (const match of methodQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      const recvNode = match.captures.find(c => c.name === 'recv')?.node;
      const bodyNode = match.captures.find(c => c.name === 'body')?.node;
      if (!defNode || !nameNode || !recvNode) continue;

      const recvType = receiverTypeName(recvNode);
      const methodName = nameNode.text;
      const dedupeKey = `${recvType ?? ''}#${methodName}`;
      if (seenMethodKeys.has(dedupeKey)) continue;
      seenMethodKeys.add(dedupeKey);

      // A method whose receiver type isn't declared in this file (common in
      // Go — a type and its methods are often split across files in the
      // same package) still gets a node, attached to the file rather than
      // dropped.
      const ownerId = (recvType && typeIdsByName.get(recvType)) || fileId;
      const methodId = normalizeNodeId(file.path, recvType ? `${recvType}#${methodName}` : methodName, 'method');
      const dupSignals = bodyNode ? buildDuplicateSignals(collectNormalizedTokens(bodyNode)) : {};
      nodes.push({
        id: methodId,
        label: methodName,
        type: 'method',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
        ...(bodyNode ? { complexity: computeComplexity(bodyNode) } : {}),
        ...(bodyNode ? { cognitiveComplexity: computeCognitiveComplexity(bodyNode, GO_COGNITIVE_CONFIG, methodName) } : {}),
        ...dupSignals,
      });
      edges.push({ source: ownerId, target: methodId, relation: 'defines' });
      if (bodyNode) callables.push({ nodeId: methodId, name: methodName, body: bodyNode });
    }

    const seenFunctionNames = new Set<string>();
    const functionQuery = getQuery(language, 'go-functions', FUNCTION_QUERY);
    for (const match of functionQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      const bodyNode = match.captures.find(c => c.name === 'body')?.node;
      if (!defNode || !nameNode) continue;

      const name = nameNode.text;
      if (seenFunctionNames.has(name)) continue;
      seenFunctionNames.add(name);

      const funcId = normalizeNodeId(file.path, name, 'function');
      const dupSignals = bodyNode ? buildDuplicateSignals(collectNormalizedTokens(bodyNode)) : {};
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
        ...(bodyNode ? { complexity: computeComplexity(bodyNode) } : {}),
        ...(bodyNode ? { cognitiveComplexity: computeCognitiveComplexity(bodyNode, GO_COGNITIVE_CONFIG, name) } : {}),
        ...dupSignals,
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
      if (bodyNode) callables.push({ nodeId: funcId, name, body: bodyNode });
    }

    extractCalls(callables, edges);

    const imports = extractImports(root);

    tree!.delete();

    return { nodes, edges, imports };
  }
}

/**
 * `(s *Server)` / `(s Server)` / `(g *Cache[K, V])` -> "Server" / "Cache".
 * Verified empirically against the shipped grammar: a receiver's single
 * `parameter_declaration` holds an optional name identifier plus exactly one
 * of `type_identifier` (value receiver), `pointer_type` (pointer receiver,
 * whose own named child is either a `type_identifier` or, for a generic
 * receiver, a `generic_type`), or a bare `generic_type` (generic value
 * receiver) — in every case the base type name is that node's own first
 * named child's text, or its own text for a plain `type_identifier`.
 */
function receiverTypeName(recv: TSNode): string | null {
  const decl = recv.namedChild(0);
  if (!decl) return null;

  for (const child of decl.namedChildren) {
    if (!child) continue;
    if (child.type === 'type_identifier') return child.text;
    if (child.type === 'generic_type') return child.namedChild(0)?.text ?? null;
    if (child.type === 'pointer_type') {
      const inner = child.namedChild(0);
      if (!inner) return null;
      return inner.type === 'generic_type' ? (inner.namedChild(0)?.text ?? null) : inner.text;
    }
  }

  return null;
}

/**
 * Same-file `calls` edges (spec 034). Only bare-identifier calls (`foo()`)
 * resolve — `x.foo()` (a `selector_expression` function field, not a plain
 * `identifier`) is deliberately left unresolved, matching every other
 * parser's no-receiver-type-information posture.
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
        const fn = node.childForFieldName('function');
        if (fn?.type === 'identifier') {
          const targetId = nameToNodeId.get(fn.text);
          if (targetId) calledIds.add(targetId);
        }
      }
      // `func_literal` (an anonymous closure) is not separately extracted,
      // so its calls roll up into the enclosing function/method — descend
      // into it, unlike the two node types below which ARE separately
      // extracted and would otherwise double-count.
      if (node.type === 'function_declaration' || node.type === 'method_declaration') return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

function extractImports(root: TSNode): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  for (const spec of root.descendantsOfType('import_spec')) {
    const path = spec?.childForFieldName('path');
    if (!path) continue;

    // Strips both interpreted (`"`) and raw (`` ` ``) Go string quoting.
    const raw = path.text.replace(/^["`]|["`]$/g, '');
    if (raw && !seen.has(raw)) {
      imports.push(raw);
      seen.add(raw);
    }
  }

  return imports;
}

/**
 * McCabe cyclomatic complexity. Same traversal boundary as every other
 * parser here: doesn't descend into a nested `function_declaration`/
 * `method_declaration`, but DOES descend into a `func_literal` (not
 * separately extracted — same posture as `extractCalls`/
 * `collectNormalizedTokens` below, and as TypeScriptParser's own arrow
 * functions).
 */
function computeComplexity(bodyNode: TSNode): number {
  let complexity = 1;

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (COMPLEXITY_NODE_TYPES.has(node.type)) complexity++;
    if (node.type === 'binary_expression') {
      const op = node.childForFieldName('operator')?.text;
      if (op === '&&' || op === '||') complexity++;
    }
    if (node.type === 'function_declaration' || node.type === 'method_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return complexity;
}

/**
 * Normalized structural token stream for duplication detection — same
 * ID/LIT/node-type-name scheme as every other tree-sitter parser here.
 */
function collectNormalizedTokens(bodyNode: TSNode): string[] {
  const tokens: string[] = [];

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (node.type === 'identifier' || node.type === 'field_identifier' || node.type === 'type_identifier' || node.type === 'package_identifier') {
      tokens.push('ID');
      return;
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      tokens.push('LIT');
      return;
    }

    tokens.push(node.type);

    if (node.type === 'function_declaration' || node.type === 'method_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

export default new GoParser();
