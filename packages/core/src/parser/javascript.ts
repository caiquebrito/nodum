import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveRelativeImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';

// Three named-function shapes: `function foo() {}`, `const foo = function()
// {}`, `const foo = () => {}` — @def captures the actual function node in
// each (the outer function_declaration itself, or the variable_declarator's
// value), not the declarator, so the body/complexity walk below always
// gets a real function node regardless of which shape matched.
const FUNCTION_QUERY = `
  (function_declaration name: (identifier) @name) @def
  (variable_declarator name: (identifier) @name value: (function_expression) @def)
  (variable_declarator name: (identifier) @name value: (arrow_function) @def)
`;
const CLASS_QUERY = '(class_declaration name: (identifier) @name) @def';

// `switch_case` counted, `switch_default` (bare `default:`) not — matching
// the old regex scorer's `\bcase\s+[^:]+:` pattern exactly, which never
// matched a bare `default:` either. `for_in_statement` covers both
// `for...of` and `for...in` in this grammar (one node type, not two).
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'catch_clause',
  'ternary_expression',
  'switch_case',
]);

const LITERAL_NODE_TYPES = new Set(['string', 'number', 'true', 'false', 'null', 'undefined']);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class JavaScriptParser extends TreeSitterParser {
  language = 'JavaScript';
  extensions = ['.js', '.mjs', '.cjs', '.jsx'];
  protected grammarFile = 'tree-sitter-javascript.wasm';

  resolveImport(specifier: string, importingFilePath: string, knownFileIds: Set<string>): string[] {
    const id = resolveRelativeImport(importingFilePath, specifier, knownFileIds);
    return id ? [id] : [];
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

    // Classes — new capability: the old regex parser extracted the class
    // node itself and nothing inside it. Same flat fileId->classId /
    // classId->methodId split as TypeScriptParser/JavaParser/PythonParser:
    // every class_declaration, at any depth, gets a flat file edge; its own
    // direct method_definition members get attributed to it.
    const seenClassNames = new Set<string>();
    const classQuery = getQuery(language, 'javascript-classes', CLASS_QUERY);
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
        if (child?.type !== 'method_definition') continue;
        const methodNameNode = child.childForFieldName('name');
        if (!methodNameNode) continue;
        const methodName = methodNameNode.text;
        if (seenMethodNames.has(methodName)) continue;
        seenMethodNames.add(methodName);

        const methodBody = child.childForFieldName('body');
        const duplicateHash = methodBody ? hashTokens(collectNormalizedTokens(methodBody)) : null;
        const methodId = normalizeNodeId(file.path, `${className}#${methodName}`, 'method');
        nodes.push({
          id: methodId,
          label: methodName,
          type: 'method',
          file: file.path,
          group: getNodeGroup(file.path),
          line: child.startPosition.row + 1,
          ...(methodBody ? { complexity: computeComplexity(methodBody) } : {}),
          ...(duplicateHash ? { duplicateHash } : {}),
        });
        edges.push({ source: classId, target: methodId, relation: 'defines' });
        if (methodBody) callables.push({ nodeId: methodId, name: methodName, body: methodBody });
      }
    }

    // Functions — no exclusion set needed: a class's method_definition
    // members are never matched by FUNCTION_QUERY (a distinct node type
    // from function_declaration/function_expression/arrow_function), so
    // there's no overlap with the class pass above to guard against,
    // unlike PythonParser's single-nesting-level case.
    const seenFunctionNames = new Set<string>();
    const functionQuery = getQuery(language, 'javascript-functions', FUNCTION_QUERY);
    for (const match of functionQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;

      const name = nameNode.text;
      if (seenFunctionNames.has(name)) continue;
      seenFunctionNames.add(name);

      const funcId = normalizeNodeId(file.path, name, 'function');
      const body = defNode.childForFieldName('body');
      // A concise-body arrow (`x => x + 1`, no braces) has a bare
      // expression as its "body", not a `statement_block` — left unscored,
      // same as the old regex parser's documented behavior (there's no
      // brace-delimited body to walk).
      const hasBlockBody = body?.type === 'statement_block';
      const duplicateHash = hasBlockBody ? hashTokens(collectNormalizedTokens(body!)) : null;
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
        ...(hasBlockBody ? { complexity: computeComplexity(body!) } : {}),
        ...(duplicateHash ? { duplicateHash } : {}),
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
      if (hasBlockBody) callables.push({ nodeId: funcId, name, body: body! });
    }

    extractCalls(callables, edges);

    const imports = extractImports(root);

    return { nodes, edges, imports };
  }
}

/**
 * Direct tree walk, not a query — mirrors both `import` statements (only
 * the source path matters, not which names are imported) and real
 * `require('x')` call expressions, matching the old regex parser's own
 * dual handling. Deduplicated, same as the old parser's `seenImports`.
 */
function extractImports(root: TSNode): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  function addSpecifier(stringNode: TSNode | null): void {
    const specifier = stringNode?.namedChildren[0]?.text; // the string_fragment, not the quoted node itself
    if (specifier && !seen.has(specifier)) {
      imports.push(specifier);
      seen.add(specifier);
    }
  }

  for (const importStmt of root.descendantsOfType('import_statement')) {
    const source = importStmt?.childForFieldName('source');
    if (source?.type === 'string') addSpecifier(source);
  }

  for (const call of root.descendantsOfType('call_expression')) {
    const fn = call?.childForFieldName('function');
    if (fn?.type !== 'identifier' || fn.text !== 'require') continue;
    const args = call!.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    if (firstArg?.type === 'string') addSpecifier(firstArg);
  }

  return imports;
}

const FUNCTION_NODE_TYPES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition']);

/**
 * McCabe cyclomatic complexity. Same traversal boundary as every other
 * parser here: doesn't descend into a nested function/method definition
 * (separately scored) — `&&`/`||` counted via `binary_expression`'s
 * `operator` field text, since this grammar (like Java's) uses one generic
 * node for every binary operator.
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
    if (FUNCTION_NODE_TYPES.has(node.type)) return;
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
    if (node.type === 'identifier' || node.type === 'property_identifier') {
      tokens.push('ID');
      return;
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      tokens.push('LIT');
      return;
    }

    tokens.push(node.type);

    if (FUNCTION_NODE_TYPES.has(node.type)) return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

/**
 * Same-file `calls` edges (spec 034). Only bare-identifier calls
 * (`foo()`) resolve — `this.foo()`/`obj.foo()` (a `member_expression`
 * function node, not a plain `identifier`) are deliberately left alone,
 * since without real type information there's no reliable way to tell
 * whether the receiver refers to something in this file. Excludes
 * `require(...)` the same way `extractImports` treats it specially —
 * `require` never resolves against `nameToNodeId` anyway, since it's never
 * a locally-defined function. First-definition-wins on a name collision,
 * matching every other extraction pass in this file.
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
      if (FUNCTION_NODE_TYPES.has(node.type)) return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

export default new JavaScriptParser();
