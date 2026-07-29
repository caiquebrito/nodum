import type { ParseResult, FileInfo, Node, Edge, NodeType } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveSwiftObjcImport } from './import-resolver.js';
import { TreeSitterParser } from './treesitter/base.js';
import { getQuery } from './treesitter/engine.js';
import type { TSNode } from './treesitter/engine.js';
import { computeCognitiveComplexity, type CognitiveConfig } from './cognitive-complexity.js';

// See cognitive-complexity.ts's CognitiveConfig doc comment. No
// `nestingOnly` entry for a block literal (`^{ }`) — unlike every other
// language's closure syntax here, this grammar's block-literal parsing
// proved unstable enough during this spec's own verification to leave
// untouched rather than risk it; blocks simply walk through as regular
// container nodes, same as `computeComplexity` above already does (it has
// no special block handling either).
const OBJC_COGNITIVE_CONFIG: CognitiveConfig = {
  nesting: new Set(['if_statement', 'for_statement', 'while_statement', 'catch_clause']),
  boundary: new Set(['method_definition', 'function_definition']),
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

// Verified empirically (spec 038): a type's name has no grammar field on
// any of these three node types — it's simply the first named child,
// always, since ObjC syntax puts the name immediately after the keyword.
// `class_interface` (a `.h` `@interface` declaration) is captured too, but
// only to extract its NOT node (see `parse()`) — it contributes imports
// only, never a type node. See the Design section in spec 038's doc for
// the declaration/definition-split rationale.
const TYPE_QUERY = `
  (class_implementation) @def
  (protocol_declaration) @def
`;

// Real decision points via actual AST node types. `case_statement` covers
// both `case N:` and a bare `default:` — excluded via `isDefaultCase()`
// below, matching every other parser here's posture that a bare default
// label isn't its own decision point. `&&`/`||` counted via
// `binary_expression`'s `operator` field, same approach as Java/JS — this
// grammar (like those) uses one generic node for every binary operator.
const COMPLEXITY_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'do_statement',
  'case_statement',
  'conditional_expression',
  'catch_clause',
]);

const LITERAL_NODE_TYPES = new Set(['number_literal', 'string_literal', 'char_literal', 'true', 'false', 'nil']);

interface CallableUnit {
  nodeId: string;
  name: string;
  body: TSNode;
}

export class ObjCParser extends TreeSitterParser {
  language = 'Objective-C';
  // `.h` is claimed here since no C/C++ parser exists yet in this registry
  // (though `tree-sitter-c.wasm` is already vendored in tree-sitter-wasms —
  // a real, accepted, time-limited collision risk for whenever a C/C++
  // parser is eventually added; not solved here).
  extensions = ['.m', '.h'];
  ignoredDirs = ['DerivedData', 'Pods', 'Carthage'];
  protected grammarFile = 'tree-sitter-objc.wasm';

  // Shared with SwiftParser — see import-resolver.ts.
  resolveImport(specifier: string, importingFilePath: string, knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[] {
    return resolveSwiftObjcImport(specifier, importingFilePath, knownFileIds, knownFilesByPath);
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

    // Type nodes: only from `@implementation`/`@protocol` — never from a
    // bare `@interface` (`class_interface`), which contributes imports only
    // (spec 038's Design: `@implementation` is where bodies/complexity/
    // hashes live; a header-only interface would otherwise produce a
    // second, memberless node under a different file-scoped id, splitting
    // every class into two disconnected nodes).
    const seenTypeNames = new Set<string>();
    const typeQuery = getQuery(language, 'objc-types', TYPE_QUERY);
    for (const match of typeQuery.matches(root)) {
      const defNode = match.captures.find(c => c.name === 'def')?.node;
      if (!defNode) continue;

      const nameNode = defNode.namedChild(0);
      if (!nameNode || nameNode.type !== 'identifier') continue;
      const typeName = nameNode.text;

      const category = defNode.childForFieldName('category');
      const kind: NodeType = category ? 'extension' : defNode.type === 'protocol_declaration' ? 'protocol' : 'class';

      // Extension id namespacing mirrors Swift's (spec 037) — avoids a
      // same-file `@implementation Foo` / `@implementation Foo (Extras)`
      // id collision, since `normalizeNodeId` ignores NodeType.
      const idName = kind === 'extension' ? `${typeName}+${category!.text}` : typeName;
      const dedupeKey = `${kind}:${idName}`;
      if (seenTypeNames.has(dedupeKey)) continue; // first-wins on a collision
      seenTypeNames.add(dedupeKey);

      const typeId = normalizeNodeId(file.path, idName, kind);
      nodes.push({
        id: typeId,
        label: kind === 'extension' ? `${typeName} (${category!.text})` : typeName,
        type: kind,
        file: file.path,
        group: getNodeGroup(file.path),
        line: defNode.startPosition.row + 1,
      });
      edges.push({ source: fileId, target: typeId, relation: 'defines' });

      // Members: `class_implementation`'s methods are each wrapped one
      // level deeper in their own `implementation_definition` (verified —
      // there is no `body:` field on `class_implementation` itself, and a
      // stray non-method construct, e.g. a mis-parsed `@property`, can
      // appear as an `implementation_definition` wrapping a plain
      // `declaration` rather than a `method_definition` — skipped, not
      // extracted). `protocol_declaration`'s `method_declaration` members
      // are direct children, no wrapper.
      const seenMemberNames = new Set<string>();
      const memberContainer = defNode.type === 'protocol_declaration' ? defNode : null;
      const memberNodes: TSNode[] = memberContainer
        ? defNode.namedChildren.filter((c): c is TSNode => c?.type === 'method_declaration')
        : defNode.namedChildren
            .filter((c): c is TSNode => c?.type === 'implementation_definition')
            .map(c => c.namedChild(0))
            .filter((c): c is TSNode => c?.type === 'method_definition');

      for (const member of memberNodes) {
        const selector = definitionSelector(member.namedChildren.filter((c): c is TSNode => c !== null));
        if (!selector) continue;
        if (seenMemberNames.has(selector)) continue; // first overload wins — same posture as every other parser here
        seenMemberNames.add(selector);

        // No `body:` field on `method_definition`/`method_declaration` — verified
        // empirically; the body (when present) is simply the last named child, a
        // `compound_statement`. Positional, not field-based, unlike every other
        // parser here's member bodies.
        const memberBody = member.namedChildren.find((c): c is TSNode => c?.type === 'compound_statement') ?? null;
        const duplicateHash = memberBody ? hashTokens(collectNormalizedTokens(memberBody)) : null;
        const methodId = normalizeNodeId(file.path, `${idName}#${selector}`, 'method');
        nodes.push({
          id: methodId,
          label: selector,
          type: 'method',
          file: file.path,
          group: getNodeGroup(file.path),
          line: member.startPosition.row + 1,
          ...(memberBody ? { complexity: computeComplexity(memberBody) } : {}),
          ...(memberBody ? { cognitiveComplexity: computeCognitiveComplexity(memberBody, OBJC_COGNITIVE_CONFIG, selector) } : {}),
          ...(duplicateHash ? { duplicateHash } : {}),
        });
        edges.push({ source: typeId, target: methodId, relation: 'defines' });
        if (memberBody) callables.push({ nodeId: methodId, name: selector, body: memberBody });
      }
    }

    // C functions, attributed to the file — real in `.m` files, and not
    // always at true file top-level: a common ObjC idiom is a `static`
    // C helper declared as a direct child of an `@implementation` block
    // (verified empirically — it's a real `function_definition`, sibling
    // to the block's `implementation_definition` method wrappers, not
    // wrapped in one itself). `descendantsOfType` finds it regardless of
    // depth; `function_definition` never nests inside another
    // function_definition/method_definition in C/ObjC, so there's no
    // double-extraction risk to guard against.
    const seenFunctionNames = new Set<string>();
    for (const child of root.descendantsOfType('function_definition')) {
      if (!child) continue;

      const declarator = child.childForFieldName('declarator');
      const name = declarator?.childForFieldName('declarator')?.text ?? 'anonymous';
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
        ...(body ? { cognitiveComplexity: computeCognitiveComplexity(body, OBJC_COGNITIVE_CONFIG, name) } : {}),
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
 * Builds an Objective-C selector from a `method_definition`'s named
 * children: `bar` (no colon) when there are no `method_parameter`s at all;
 * `doThing:withOther:` (every identifier segment followed by a colon) when
 * there are — ObjC has no third shape. Verified empirically.
 */
function definitionSelector(children: TSNode[]): string {
  const identifiers = children.filter(c => c.type === 'identifier');
  const hasParams = children.some(c => c.type === 'method_parameter');
  return hasParams ? identifiers.map(id => `${id.text}:`).join('') : identifiers.map(id => id.text).join('');
}

/**
 * Builds the same selector shape from a `message_expression`'s
 * post-receiver named children, by **position**, not by node type.
 * `[self baz:y]`'s post-receiver children are `[identifier"baz",
 * identifier"y"]` — the selector part *and* the argument are both plain
 * `identifier` nodes when the argument is itself a bare variable
 * reference, so "count non-identifiers" (an earlier, wrong version of this
 * function) cannot tell them apart. ObjC's grammar strictly alternates
 * selector-part, argument, selector-part, argument, ... after the
 * receiver — a zero-arg send has exactly one child (the bare selector); an
 * N-arg send has an even-indexed selector identifier at position
 * `0, 2, 4, ...`. Verified empirically.
 */
function callSelector(restChildren: TSNode[]): string {
  if (restChildren.length === 0) return '';

  const parts: string[] = [];
  for (let i = 0; i < restChildren.length; i += 2) {
    const seg = restChildren[i];
    if (seg?.type !== 'identifier') break;
    parts.push(seg.text);
  }

  const hasArgs = restChildren.length > 1;
  return hasArgs ? parts.map(p => `${p}:`).join('') : parts.join('');
}

function isDefaultCase(node: TSNode): boolean {
  return node.child(0)?.type === 'default';
}

/**
 * McCabe cyclomatic complexity, walking `bodyNode`'s subtree. Same
 * traversal boundary as every other parser here: doesn't descend into a
 * nested `method_definition`/`function_definition` (separately scored).
 */
function computeComplexity(bodyNode: TSNode): number {
  let complexity = 1;

  function visit(node: TSNode | null): void {
    if (!node) return;
    if (node.type === 'case_statement' && isDefaultCase(node)) {
      // a bare `default:` isn't its own decision point — matches every
      // other parser's switch/case posture
    } else if (COMPLEXITY_NODE_TYPES.has(node.type)) {
      complexity++;
    }
    if (node.type === 'binary_expression') {
      const op = node.childForFieldName('operator')?.text;
      if (op === '&&' || op === '||') complexity++;
    }
    if (node.type === 'method_definition' || node.type === 'function_definition') return;
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

    if (node.type === 'method_definition' || node.type === 'function_definition') return;
    for (const child of node.namedChildren) visit(child);
  }

  for (const child of bodyNode.namedChildren) visit(child);
  return tokens;
}

/**
 * Same-file `calls` edges (spec 034), applied to Objective-C (spec 038)
 * with one deliberate, documented divergence from every other parser's
 * rule: `self`/`super`-receiver message sends DO resolve. Objective-C has
 * no bare method-call syntax at all — every method call is
 * `[receiver message]` — so applying the other parsers' "unqualified calls
 * only" rule verbatim would make this parser's `calls` support provably
 * inert (it would emit nothing but rare bare C-function calls). A
 * `self`/`super` receiver inside an `@implementation` has a
 * statically-known type — the enclosing class — making it *more* reliable
 * to resolve than the bare-identifier lookup the other four parsers
 * already accept, not less. Any other receiver (`[obj foo]`) still does
 * not resolve — no type information is available for it.
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

      if (node.type === 'message_expression') {
        const receiver = node.namedChild(0);
        if (receiver?.type === 'identifier' && (receiver.text === 'self' || receiver.text === 'super')) {
          const selector = callSelector(node.namedChildren.slice(1).filter((c): c is TSNode => c !== null));
          const targetId = selector ? nameToNodeId.get(selector) : undefined;
          if (targetId) calledIds.add(targetId);
        }
      } else if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (fn?.type === 'identifier') {
          const targetId = nameToNodeId.get(fn.text);
          if (targetId) calledIds.add(targetId);
        }
      }

      if (node.type === 'method_definition' || node.type === 'function_definition') return;
      for (const child of node.namedChildren) visit(child);
    }

    for (const child of body.namedChildren) visit(child);

    for (const targetId of calledIds) {
      edges.push({ source: nodeId, target: targetId, relation: 'calls' });
    }
  }
}

/**
 * `#import <F/F.h>` / `#include <F/F.h>` (angle, `system_lib_string`,
 * external — resolves to `[]`), `#import "H.h"` / `#include "H.h"` (quoted,
 * `string_literal`, filename-suffix match), `@import M;` (`module_import`,
 * module-name directory match) — verified empirically (spec 038).
 */
function extractImports(root: TSNode): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  const add = (specifier: string | undefined): void => {
    if (specifier && !seen.has(specifier)) {
      imports.push(specifier);
      seen.add(specifier);
    }
  };

  for (const inc of root.descendantsOfType('preproc_include')) {
    if (!inc) continue;
    const path = inc.childForFieldName('path');
    if (path?.type === 'string_literal') {
      add(path.namedChildren.find(c => c?.type === 'string_content')?.text);
    }
    // system_lib_string (angle-bracket) is intentionally not added — an
    // external framework import, not a same-project file.
  }

  for (const mod of root.descendantsOfType('module_import')) {
    if (!mod) continue;
    add(mod.childForFieldName('path')?.text);
  }

  return imports;
}

export default new ObjCParser();
