import type { ParseResult, FileInfo, Node, NodeType, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { buildDuplicateSignals } from './duplicate-hash.js';
import { resolveJvmImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';
import { computeCognitiveComplexity, type CognitiveConfig } from './cognitive-complexity.js';

// See cognitive-complexity.ts's CognitiveConfig doc comment. `when_entry`
// (Kotlin's switch-equivalent) is deliberately excluded — not scored at
// all in this implementation, same posture as every other language's
// switch/case exclusion (see that module's doc comment).
const KOTLIN_COGNITIVE_CONFIG: CognitiveConfig = {
  nesting: new Set(['if_expression', 'for_statement', 'while_statement', 'do_while_statement', 'catch_block']),
  nestingOnly: new Set(['lambda_literal']),
  boundary: new Set(['function_declaration']),
  isBooleanOp: node => node.type === 'conjunction_expression' || node.type === 'disjunction_expression',
  calleeName: node => {
    if (node.type !== 'call_expression') return null;
    const fn = node.namedChild(0);
    return fn?.type === 'simple_identifier' ? fn.text : null;
  },
};

// This grammar (fwcd/tree-sitter-kotlin) carries NO field names anywhere —
// `childForFieldName` returns null for every node, unlike every other
// tree-sitter grammar this codebase uses. Every query and every extraction
// below is positional/type-based instead (e.g. "the class's name is its
// direct `type_identifier` child"), verified empirically against the real
// shipped grammar before writing any of this.
const TYPE_QUERY = `
  (class_declaration (type_identifier) @name) @def
  (object_declaration (type_identifier) @name) @def
`;
const FUNCTION_QUERY = '(function_declaration (simple_identifier) @name) @def';

// Kotlin's `if` is an expression (if_expression), not a statement, unlike
// every C-family grammar this codebase otherwise parses. `elvis_expression`
// (`?:`) is now counted — the old regex parser deliberately excluded it as
// a false-positive-prone workaround for a bare `?` also appearing in
// nullable-type syntax (`String?`), a concern that doesn't apply to a real
// AST where `elvis_expression` is an unambiguous node type. This is a
// genuine, documented behavior change (see spec 044's Design), matching
// swift.ts's own `nil_coalescing_expression` precedent. `when_entry`
// excludes the `else ->` branch the same way switch/when-style parsers
// elsewhere in this codebase exclude their default branch.
// `when_entry` is handled separately in computeComplexity (its `else ->`
// branch must be excluded), not folded into this set.
const COMPLEXITY_NODE_TYPES = new Set([
  'if_expression',
  'for_statement',
  'while_statement',
  'do_while_statement',
  'catch_block',
  'elvis_expression',
  'conjunction_expression', // && — a dedicated node type in this grammar, no operator-field check needed
  'disjunction_expression', // ||
]);

const LITERAL_NODE_TYPES = new Set([
  'integer_literal',
  'real_literal',
  'long_literal',
  'hex_literal',
  'bin_literal',
  'boolean_literal',
  'character_literal',
  'string_literal',
  'null',
]);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class KotlinParser extends TreeSitterParser {
  language = 'Kotlin';
  extensions = ['.kt'];
  ignoredDirs = ['.gradle', 'target'];
  protected grammarFile = 'tree-sitter-kotlin.wasm';

  // Shared with JavaParser — both JVM languages resolve dotted-FQN imports
  // the same suffix-matching way. Import specifier format (dotted FQN,
  // optional `.*` wildcard suffix) is unchanged by this migration, so this
  // delegation needs no changes — the existing import tests below assert
  // byte-identical output to the old regex parser as this migration's
  // explicit contract.
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

    // Every class/object, at any nesting depth, gets a flat fileId->id edge
    // — matching java.ts's own precedent. `object`/`data class`/
    // `sealed class` all collapse to `'class'` (no dedicated NodeType
    // exists for them); only `interface`/`enum` split out, since both
    // already exist as NodeType members (spec 036). A `companion object`
    // is a distinct `companion_object` node type (not matched by this
    // query at all — its members are deliberately not extracted, see
    // Design), so it never becomes a node here.
    const seenTypeNames = new Set<string>();
    const typeQuery = getQuery(language, 'kotlin-types', TYPE_QUERY);
    for (const match of typeQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      if (!defNode || !nameNode) continue;

      const typeName = nameNode.text;
      const dedupeKey = `${defNode.type}:${typeName}`;
      if (seenTypeNames.has(dedupeKey)) continue;
      seenTypeNames.add(dedupeKey);

      const kind = kotlinDeclKind(defNode);
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

      // `class_body` (class/interface) or `enum_class_body` (enum class) —
      // only direct `function_declaration` children are real members here.
      // `companion_object`/`secondary_constructor`/nested
      // `class_declaration`/`object_declaration` children are deliberately
      // skipped (documented scope reductions, see Design), and this
      // direct-children-only walk is what makes the skip automatic — it
      // never recurses into them looking for more functions.
      const body = defNode.namedChildren.find(c => c?.type === 'class_body' || c?.type === 'enum_class_body');
      if (!body) continue;

      const seenMemberNames = new Set<string>();
      for (const child of body.namedChildren) {
        if (child?.type !== 'function_declaration') continue;

        const memberNameNode = child.namedChildren.find(c => c?.type === 'simple_identifier');
        if (!memberNameNode) continue;
        const memberName = memberNameNode.text;
        if (seenMemberNames.has(memberName)) continue; // first overload wins — same posture as every other parser here
        seenMemberNames.add(memberName);

        // Absent for an abstract interface method (`fun get(): Int` with no
        // body) — still gets a method node, just no complexity/duplicateHash,
        // matching java.ts's own abstract-method posture.
        const memberBody = child.namedChildren.find(c => c?.type === 'function_body');
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
          ...(memberBody ? { cognitiveComplexity: computeCognitiveComplexity(memberBody, KOTLIN_COGNITIVE_CONFIG, memberName) } : {}),
          ...dupSignals,
        });
        edges.push({ source: typeId, target: methodId, relation: 'defines' });
        if (memberBody) callables.push({ nodeId: methodId, name: memberName, body: memberBody });
      }
    }

    // Top-level functions only — a direct-children-of-`source_file` walk,
    // deliberately not a global query. This is what keeps class methods,
    // companion-object functions, and local (nested-inside-another-
    // function) functions all out of this pass with no exclusion-set
    // bookkeeping needed: none of them are direct children of the root.
    // Local/nested functions are consequently not extracted as their own
    // nodes at all — a documented scope reduction, matching swift.ts's own
    // precedent for local functions.
    const seenFunctionNames = new Set<string>();
    for (const defNode of root.namedChildren) {
      if (defNode?.type !== 'function_declaration') continue;

      const nameNode = defNode.namedChildren.find(c => c?.type === 'simple_identifier');
      if (!nameNode) continue;
      const name = nameNode.text;
      if (seenFunctionNames.has(name)) continue;
      seenFunctionNames.add(name);

      const body = defNode.namedChildren.find(c => c?.type === 'function_body');
      const dupSignals = body ? buildDuplicateSignals(collectNormalizedTokens(body)) : {};
      const funcId = normalizeNodeId(file.path, name, 'function');
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
        ...(body ? { complexity: computeComplexity(body) } : {}),
        ...(body ? { cognitiveComplexity: computeCognitiveComplexity(body, KOTLIN_COGNITIVE_CONFIG, name) } : {}),
        ...dupSignals,
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
 * `interface`/`enum class` both parse as `class_declaration` with a keyword
 * TOKEN child (no field name) distinguishing them — `enum class` carries
 * BOTH an `enum` and a `class` token child, so `enum` must be checked
 * before falling through to the `class` default. `object_declaration` has
 * no keyword-child ambiguity to resolve (no dedicated `NodeType` exists for
 * a plain `object`, so it collapses to `'class'`, matching `data class`/
 * `sealed class`, both of which are `class_modifier` children rather than
 * distinct node types).
 */
function kotlinDeclKind(defNode: TSNode): NodeType {
  if (defNode.type === 'object_declaration') return 'class';

  let sawEnum = false;
  for (let i = 0; i < defNode.childCount; i++) {
    const childType = defNode.child(i)?.type;
    if (childType === 'interface') return 'interface';
    if (childType === 'enum') sawEnum = true;
  }
  return sawEnum ? 'enum' : 'class';
}

/**
 * Same-file `calls` edges (spec 034). Only bare-identifier calls (`foo()`)
 * resolve — `this.foo()`/`obj.foo()` (a `navigation_expression` function,
 * not a plain `simple_identifier`) are deliberately left unresolved,
 * matching every other parser's no-receiver-type-information posture.
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
        const fn = node.namedChild(0);
        if (fn?.type === 'simple_identifier') {
          const targetId = nameToNodeId.get(fn.text);
          if (targetId) calledIds.add(targetId);
        }
      }
      // `lambda_literal` is not separately extracted, so its calls roll up
      // into the enclosing function/method — descend into it, unlike
      // `function_declaration` below, which IS separately extracted.
      if (node.type === 'function_declaration') return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

/**
 * Byte-identical specifier format to the old regex parser (dotted FQN,
 * optional `.*` wildcard suffix) — this migration's explicit import
 * contract, verified by the pre-existing import tests passing unmodified.
 */
function extractImports(root: TSNode): string[] {
  const imports: string[] = [];

  for (const header of root.descendantsOfType('import_header')) {
    if (!header) continue;

    const dotted = header.namedChildren.find(c => c?.type === 'identifier');
    if (!dotted) continue;

    const isWildcard = header.namedChildren.some(c => c?.type === 'wildcard_import');
    const dottedText = dotted.namedChildren
      .filter((c): c is TSNode => c !== null)
      .map(c => c.text)
      .join('.');

    imports.push(isWildcard ? `${dottedText}.*` : dottedText);
  }

  return imports;
}

/**
 * McCabe cyclomatic complexity. Traversal boundary stops at a nested
 * `function_declaration`, but DOES descend into a `lambda_literal` — not
 * separately extracted, same posture as `extractCalls`/
 * `collectNormalizedTokens` below.
 */
function computeComplexity(bodyNode: TSNode): number {
  let complexity = 1;

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (COMPLEXITY_NODE_TYPES.has(node.type)) complexity++;
    if (node.type === 'when_entry' && node.namedChildren.some(c => c?.type === 'when_condition')) {
      complexity++; // a real branch — the `else ->` entry has no when_condition child, and doesn't count
    }
    if (node.type === 'function_declaration') return;
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
    if (node.type === 'simple_identifier' || node.type === 'type_identifier') {
      tokens.push('ID');
      return;
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      tokens.push('LIT');
      return;
    }

    tokens.push(node.type);

    if (node.type === 'function_declaration') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

export default new KotlinParser();
