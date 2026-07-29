import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { hashTokens } from './duplicate-hash.js';
import { resolvePythonImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';
import { computeCognitiveComplexity, type CognitiveConfig } from './cognitive-complexity.js';

// See cognitive-complexity.ts's CognitiveConfig doc comment. `elif_clause`
// is a real, distinct node type in this grammar (a direct child of the
// `if_statement`, not a re-nested `if_statement` the way most other
// grammars this codebase covers represent `else if`) — see spec 045's
// Design for what that does and doesn't buy this implementation.
const PYTHON_COGNITIVE_CONFIG: CognitiveConfig = {
  nesting: new Set(['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause']),
  nestingOnly: new Set(['lambda']),
  boundary: new Set(['function_definition']),
  isBooleanOp: node => node.type === 'boolean_operator',
  calleeName: node => (node.type === 'call' && node.childForFieldName('function')?.type === 'identifier'
    ? (node.childForFieldName('function') as TSNode).text
    : null),
};

const FUNCTION_QUERY = '(function_definition name: (identifier) @name) @def';
const CLASS_QUERY = '(class_definition name: (identifier) @name) @def';

// Real decision points, now including the ternary `conditional_expression` —
// the old regex-based complexity scorer deliberately excluded ternaries
// across all three of its languages (spec 014, to dodge a Kotlin `String?`
// false-positive); tree-sitter distinguishes it precisely, so there's
// nothing to dodge here.
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'elif_clause',
  'for_statement',
  'while_statement',
  'except_clause',
  'conditional_expression',
  'boolean_operator', // always exactly `and`/`or` in this grammar — no operator-token check needed
]);

const LITERAL_NODE_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none']);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class PythonParser extends TreeSitterParser {
  language = 'Python';
  extensions = ['.py'];
  ignoredDirs = ['__pycache__', '.venv', 'venv'];
  protected grammarFile = 'tree-sitter-python.wasm';

  resolveImport(
    specifier: string,
    importingFilePath: string,
    knownFileIds: Set<string>,
    knownFilesByPath: Map<string, string>,
  ): string[] {
    return resolvePythonImport(specifier, importingFilePath, knownFileIds, knownFilesByPath);
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

    // Classes first, so their method function_definitions can be excluded
    // from the flat function pass below (matching TypeScriptParser's
    // precedent: a class's methods get classId->methodId edges; every
    // other function_definition — top-level or nested inside another
    // function — gets a flat fileId->funcId edge, regardless of depth).
    const methodStartIndices = new Set<number>();
    const seenClassNames = new Set<string>();

    const classQuery = getQuery(language, 'python-classes', CLASS_QUERY);
    for (const match of classQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;

      const className = nameNode.text;
      if (seenClassNames.has(className)) continue;
      seenClassNames.add(className);

      const classId = normalizeNodeId(file.path, className, 'class');
      nodes.push({
        id: classId,
        label: className,
        type: 'class',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
      });
      edges.push({ source: fileId, target: classId, relation: 'defines' });

      const body = defNode.childForFieldName('body');
      if (!body) continue;

      const seenMethodNames = new Set<string>();
      for (const child of body.namedChildren) {
        const methodDef =
          child?.type === 'function_definition'
            ? child
            : child?.type === 'decorated_definition'
              ? child.childForFieldName('definition')
              : null;
        if (!methodDef || methodDef.type !== 'function_definition') continue;

        const methodNameNode = methodDef.childForFieldName('name');
        if (!methodNameNode) continue;
        const methodName = methodNameNode.text;
        if (seenMethodNames.has(methodName)) continue;
        seenMethodNames.add(methodName);
        methodStartIndices.add(methodDef.startIndex);

        const methodId = normalizeNodeId(file.path, `${className}#${methodName}`, 'method');
        const methodBody = methodDef.childForFieldName('body');
        const duplicateHash = methodBody ? hashTokens(collectNormalizedTokens(methodBody)) : null;
        nodes.push({
          id: methodId,
          label: methodName,
          type: 'method',
          file: file.path,
          group: getNodeGroup(file.path),
          line: methodDef.startPosition.row + 1,
          ...(methodBody ? { complexity: computeComplexity(methodBody) } : {}),
          ...(methodBody ? { cognitiveComplexity: computeCognitiveComplexity(methodBody, PYTHON_COGNITIVE_CONFIG, methodName) } : {}),
          ...(duplicateHash ? { duplicateHash } : {}),
        });
        edges.push({ source: classId, target: methodId, relation: 'defines' });
        if (methodBody) callables.push({ nodeId: methodId, name: methodName, body: methodBody });
      }
    }

    // Every remaining function_definition (top-level, or nested inside
    // another function — a closure) — not just direct children of the
    // module, matching TypeScriptParser's own recursive-visit behavior.
    const seenFunctionNames = new Set<string>();
    const functionQuery = getQuery(language, 'python-functions', FUNCTION_QUERY);
    for (const match of functionQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;
      if (methodStartIndices.has(defNode.startIndex)) continue;

      const name = nameNode.text;
      if (seenFunctionNames.has(name)) continue;
      seenFunctionNames.add(name);

      const funcId = normalizeNodeId(file.path, name, 'function');
      const body = defNode.childForFieldName('body');
      const duplicateHash = body ? hashTokens(collectNormalizedTokens(body)) : null;
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
        ...(body ? { complexity: computeComplexity(body) } : {}),
        ...(body ? { cognitiveComplexity: computeCognitiveComplexity(body, PYTHON_COGNITIVE_CONFIG, name) } : {}),
        ...(duplicateHash ? { duplicateHash } : {}),
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
      if (body) callables.push({ nodeId: funcId, name, body });
    }

    extractCalls(callables, edges);

    const imports = extractImports(root);

    tree!.delete();

    return { nodes, edges, imports };
  }
}

/**
 * Extracted as a direct tree walk rather than a query — unlike
 * function/class extraction (a flat capture-per-match), import specifiers
 * need per-statement branching (bare `import a, b` is two separate module
 * specifiers; `from x import a, b` is one) that's awkward to express as
 * flat query captures.
 *
 * Specifiers are encoded for `resolvePythonImport()` to unpack:
 *  - absolute: the dotted path as-is, e.g. `"os.path"`
 *  - relative: leading dots (package levels up) + dotted remainder, e.g.
 *    `".pkg"`, `"..pkg"`, or `".sibling"` for a bare `from . import sibling`
 *    (whose imported name doubles as the module to try resolving, since
 *    that's the idiomatic meaning of that form).
 */
function extractImports(root: TSNode): string[] {
  const imports: string[] = [];

  for (const stmt of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
    if (!stmt) continue;

    if (stmt.type === 'import_statement') {
      // Each `name:` field is its own module — `import os, sys` is two.
      for (const child of stmt.namedChildren) {
        if (!child) continue;
        const dotted = child.type === 'aliased_import' ? child.childForFieldName('name') : child;
        if (dotted?.type === 'dotted_name') imports.push(dottedNameText(dotted));
      }
      continue;
    }

    // import_from_statement: one module, one-or-more imported names — only
    // the module matters for resolution.
    const moduleName = stmt.childForFieldName('module_name');
    if (!moduleName) continue;

    if (moduleName.type === 'dotted_name') {
      imports.push(dottedNameText(moduleName));
    } else if (moduleName.type === 'relative_import') {
      const prefix = moduleName.namedChildren.find(c => c?.type === 'import_prefix');
      const dots = '.'.repeat(prefix?.text.length ?? 1);
      const dottedPart = moduleName.namedChildren.find(c => c?.type === 'dotted_name');

      if (dottedPart) {
        imports.push(`${dots}${dottedNameText(dottedPart)}`);
      } else {
        // Bare `from . import x` / `from .. import x` — each imported name
        // is itself a candidate sibling module.
        for (const nameChild of stmt.namedChildren) {
          if (nameChild === moduleName || !nameChild) continue;
          const dotted =
            nameChild.type === 'aliased_import' ? nameChild.childForFieldName('name') : nameChild;
          if (dotted?.type === 'dotted_name') imports.push(`${dots}${dottedNameText(dotted)}`);
        }
      }
    }
  }

  return imports;
}

/**
 * Same-file `calls` edges (spec 034). Only bare-identifier calls
 * (`foo()`) resolve — `self.foo()`/`obj.foo()` (an `attribute` function
 * node, not a plain `identifier`) are deliberately left alone, since
 * without real type information there's no reliable way to tell whether
 * the receiver refers to something in this file. First-definition-wins on
 * a name collision, matching every other extraction pass in this file.
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
      if (node.type === 'call') {
        const fn = node.childForFieldName('function');
        if (fn?.type === 'identifier') {
          const targetId = nameToNodeId.get(fn.text);
          if (targetId) calledIds.add(targetId);
        }
      }
      if (node.type === 'function_definition') return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

function dottedNameText(dottedName: TSNode): string {
  return dottedName.namedChildren
    .filter((c): c is TSNode => c !== null)
    .map(c => c.text)
    .join('.');
}

/**
 * McCabe cyclomatic complexity, walking `bodyNode`'s subtree. Same
 * traversal boundary as `TypeScriptParser.computeComplexity`: doesn't
 * descend into a nested `function_definition` (separately scored), does
 * descend into everything else.
 */
function computeComplexity(bodyNode: TSNode): number {
  let complexity = 1;

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (COMPLEXITY_NODE_TYPES.has(node.type)) complexity++;
    if (node.type === 'function_definition') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return complexity;
}

/**
 * Normalized structural token stream for duplication detection — `ID` for
 * identifiers, `LIT` for literals, the tree-sitter node type name
 * otherwise. Same nested-function traversal boundary as `computeComplexity`.
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

    if (node.type === 'function_definition') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

export default new PythonParser();
