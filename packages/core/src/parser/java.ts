import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { buildDuplicateSignals } from './duplicate-hash.js';
import { resolveJvmImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';
import { computeCognitiveComplexity, type CognitiveConfig } from './cognitive-complexity.js';

// See cognitive-complexity.ts's CognitiveConfig doc comment.
const JAVA_COGNITIVE_CONFIG: CognitiveConfig = {
  nesting: new Set([
    'if_statement',
    'for_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'catch_clause',
  ]),
  nestingOnly: new Set(['lambda_expression']),
  boundary: new Set(['method_declaration', 'constructor_declaration']),
  isBooleanOp: node => {
    if (node.type !== 'binary_expression') return false;
    const op = node.childForFieldName('operator')?.text;
    return op === '&&' || op === '||';
  },
  calleeName: node => {
    if (node.type !== 'method_invocation' || node.childForFieldName('object')) return null;
    return node.childForFieldName('name')?.text ?? null;
  },
};

// One query covering both — a plain node-type check (`defNode.type`)
// distinguishes class from interface at capture time.
const TYPE_QUERY = `
  (class_declaration name: (identifier) @name) @def
  (interface_declaration name: (identifier) @name) @def
`;

// Real decision points via actual AST node types — no more CONTROL_FLOW_WORDS
// guard against "} else if (...)" matching as a method named "if", and no
// more missed constructors (the old regex needed two words before the
// paren, which "public Foo(" never has once "public" is consumed as a
// modifier). `enhanced_for_statement` (`for (T x : xs)`) and `do_statement`
// are distinct node types from `for_statement`/`while_statement` in this
// grammar — both counted, matching the old regex's intent even though it
// never actually distinguished them either.
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
  'catch_clause',
  'ternary_expression', // this grammar's name for what TS/Python call a conditional expression
]);

const LITERAL_NODE_TYPES = new Set([
  'decimal_integer_literal',
  'hex_integer_literal',
  'octal_integer_literal',
  'decimal_floating_point_literal',
  'string_literal',
  'character_literal',
  'true',
  'false',
  'null_literal',
]);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class JavaParser extends TreeSitterParser {
  language = 'Java';
  extensions = ['.java'];
  ignoredDirs = ['.gradle', 'target'];
  protected grammarFile = 'tree-sitter-java.wasm';

  // Shared with KotlinParser — see the comment there. Import specifier
  // format (dotted FQN, optional `.*` wildcard suffix) is unchanged by this
  // migration, so this delegation needs no changes.
  resolveImport(specifier: string, _importingFilePath: string, _knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[] {
    return resolveJvmImport(specifier, knownFilesByPath);
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

    // Every class/interface, at any nesting depth, gets a flat
    // fileId->id edge — matching TypeScriptParser's own precedent (it
    // doesn't track an enclosing-class scope for class/interface edges,
    // only for their member methods). Each one's own direct member
    // methods/constructors are then attributed to *that* declaration —
    // since a method is only ever a direct child of exactly one
    // class/interface body, no exclusion-tracking is needed the way
    // PythonParser needs it for its flatter (no interfaces, no nesting
    // depth beyond one) function/method split.
    const seenTypeNames = new Set<string>();
    const typeQuery = getQuery(language, 'java-types', TYPE_QUERY);
    for (const match of typeQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;

      const typeName = nameNode.text;
      const dedupeKey = `${defNode.type}:${typeName}`;
      if (seenTypeNames.has(dedupeKey)) continue;
      seenTypeNames.add(dedupeKey);

      const kind: 'class' | 'interface' = defNode.type === 'interface_declaration' ? 'interface' : 'class';
      const typeId = normalizeNodeId(file.path, typeName, kind);
      nodes.push({
        id: typeId,
        label: typeName,
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
        if (child.type !== 'method_declaration' && child.type !== 'constructor_declaration') continue;

        const memberNameNode = child.childForFieldName('name');
        if (!memberNameNode) continue;
        const memberName = memberNameNode.text;
        if (seenMemberNames.has(memberName)) continue; // first overload wins — same posture as every other parser here
        seenMemberNames.add(memberName);

        const memberBody = child.childForFieldName('body'); // `block` for methods, `constructor_body` for constructors — either walks the same way
        const dupSignals = memberBody ? buildDuplicateSignals(collectNormalizedTokens(memberBody)) : {};
        const methodId = normalizeNodeId(file.path, `${typeName}#${memberName}`, 'method');
        nodes.push({
          id: methodId,
          label: memberName,
          type: 'method',
          file: file.path,
          group: getNodeGroup(file.path),
          line: child.startPosition.row + 1,
          ...(memberBody ? { complexity: computeComplexity(memberBody) } : {}),
          ...(memberBody ? { cognitiveComplexity: computeCognitiveComplexity(memberBody, JAVA_COGNITIVE_CONFIG, memberName) } : {}),
          ...dupSignals,
        });
        edges.push({ source: typeId, target: methodId, relation: 'defines' });
        if (memberBody) callables.push({ nodeId: methodId, name: memberName, body: memberBody });
      }
    }

    extractCalls(callables, edges);

    const imports = extractImports(root);

    tree!.delete();
    parser.delete();

    return { nodes, edges, imports };
  }
}

/**
 * Same-file `calls` edges (spec 034). Only bare calls (`foo()`, no
 * `object:` field) resolve — `this.foo()`/`obj.foo()` are deliberately
 * left alone, since without real type information there's no reliable way
 * to tell whether the receiver refers to something in this file.
 * First-definition-wins on a name collision, matching every other
 * extraction pass in this file.
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
      if (node.type === 'method_invocation' && !node.childForFieldName('object')) {
        const nameNode = node.childForFieldName('name');
        const targetId = nameNode ? nameToNodeId.get(nameNode.text) : undefined;
        if (targetId) calledIds.add(targetId);
      }
      if (node.type === 'method_declaration' || node.type === 'constructor_declaration') return;
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

  for (const importDecl of root.descendantsOfType('import_declaration')) {
    if (!importDecl) continue;

    let dottedNode: TSNode | null = null;
    let isWildcard = false;
    for (let i = 0; i < importDecl.childCount; i++) {
      const child = importDecl.child(i);
      if (!child) continue;
      if (child.type === 'scoped_identifier' || child.type === 'identifier') dottedNode = child;
      if (child.type === 'asterisk') isWildcard = true;
    }

    if (dottedNode) imports.push(isWildcard ? `${dottedNode.text}.*` : dottedNode.text);
  }

  return imports;
}

/**
 * McCabe cyclomatic complexity. Same traversal boundary as every other
 * parser here: doesn't descend into a nested `method_declaration`/
 * `constructor_declaration` (a Java local/anonymous class's own methods
 * would be separately scored if that class is itself walked — this only
 * guards against the rarer case of counting a directly nested method
 * declaration's branches twice).
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
    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') return;
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
    if (node.type === 'identifier') {
      tokens.push('ID');
      return;
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      tokens.push('LIT');
      return;
    }

    tokens.push(node.type);

    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

export default new JavaParser();
