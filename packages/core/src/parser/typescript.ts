import ts from 'typescript';
import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveRelativeImport } from './import-resolver.js';
import { computeCognitiveComplexityTs } from './cognitive-complexity-ts.js';

interface CallableUnit {
  nodeId: string;
  name: string;
  body: ts.Node;
}

export class TypeScriptParser extends Parser {
  language = 'TypeScript';
  extensions = ['.ts', '.tsx'];

  resolveImport(specifier: string, importingFilePath: string, knownFileIds: Set<string>): string[] {
    const id = resolveRelativeImport(importingFilePath, specifier, knownFileIds);
    return id ? [id] : [];
  }

  async parse(file: FileInfo): Promise<ParseResult> {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const imports: string[] = [];
    const callables: CallableUnit[] = [];
    const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);

    // File node
    const fileId = normalizeNodeId(file.path, file.path, 'file');
    nodes.push({
      id: fileId,
      label: file.path.split('/').pop() || file.path,
      type: 'file',
      file: file.path,
      group: getNodeGroup(file.path),
    });

    // Visit all declarations
    this.visitNode(sourceFile, nodes, edges, imports, callables, file.path, fileId);

    // Same-file `calls` edges (spec 034) — a second pass, once every
    // function/method in this file has a node id, so a call can resolve
    // against the full file-local name table regardless of source order
    // (a function calling one declared later in the same file still
    // resolves correctly).
    this.extractCalls(callables, edges);

    return { nodes, edges, imports };
  }

  private visitNode(
    node: ts.Node,
    nodes: Node[],
    edges: Edge[],
    imports: string[],
    callables: CallableUnit[],
    filePath: string,
    fileId: string,
  ): void {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      const name = (node.name?.getText() || 'anonymous').replace(/\s+/g, '');
      const funcId = normalizeNodeId(filePath, name, 'function');
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: filePath,
        group: getNodeGroup(filePath),
        ...(node.body ? { complexity: this.computeComplexity(node.body) } : {}),
        ...(node.body ? { cognitiveComplexity: computeCognitiveComplexityTs(node.body, name) } : {}),
        ...(node.body ? this.duplicateHashField(node.body) : {}),
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
      if (node.body) callables.push({ nodeId: funcId, name, body: node.body });
    } else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const name = (node.name?.getText() || 'anonymous').replace(/\s+/g, '');
      const type = ts.isInterfaceDeclaration(node) ? 'interface' : 'class';
      const classId = normalizeNodeId(filePath, name, type as 'interface' | 'class');
      nodes.push({
        id: classId,
        label: name,
        type,
        file: filePath,
        group: getNodeGroup(filePath),
      });
      edges.push({ source: fileId, target: classId, relation: 'defines' });

      // Methods within class
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        node.members?.forEach(member => {
          if (ts.isMethodDeclaration(member)) {
            const methodName = (member.name?.getText() || 'method').replace(/\s+/g, '');
            const methodId = normalizeNodeId(filePath, `${name}#${methodName}`, 'method');
            nodes.push({
              id: methodId,
              label: methodName,
              type: 'method',
              file: filePath,
              group: getNodeGroup(filePath),
              ...(member.body ? { complexity: this.computeComplexity(member.body) } : {}),
              ...(member.body ? { cognitiveComplexity: computeCognitiveComplexityTs(member.body, methodName) } : {}),
              ...(member.body ? this.duplicateHashField(member.body) : {}),
            });
            edges.push({ source: classId, target: methodId, relation: 'defines' });
            if (member.body) callables.push({ nodeId: methodId, name: methodName, body: member.body });
          }
        });
      }
    }

    // Extract imports — resolution (relative vs bare, and actually locating
    // the target file) happens later in graph-gen.ts, once every file in the
    // project is known. A single-file parse() call has no visibility into
    // the rest of the project.
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      const moduleName = this.extractModuleName(node);
      if (moduleName) {
        imports.push(moduleName);
      }
    }

    ts.forEachChild(node, child => this.visitNode(child, nodes, edges, imports, callables, filePath, fileId));
  }

  /**
   * McCabe cyclomatic complexity, walking `bodyNode`'s subtree. Does not
   * descend into a nested FunctionDeclaration/MethodDeclaration — those are
   * separately-extracted nodes that get their own score, so counting their
   * branches here would double-count. Does descend into ArrowFunction/
   * FunctionExpression bodies, since those aren't extracted as separate
   * nodes today — their branching rolls up into the enclosing scored unit.
   */
  private computeComplexity(bodyNode: ts.Node): number {
    let complexity = 1;

    const visit = (node: ts.Node): void => {
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression:
          complexity++;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const op = (node as ts.BinaryExpression).operatorToken.kind;
          if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
            complexity++;
          }
          break;
        }
      }

      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        return; // separately-scored node — don't descend
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(bodyNode, visit);
    return complexity;
  }

  private duplicateHashField(bodyNode: ts.Node): { duplicateHash: string } | Record<string, never> {
    const hash = hashTokens(this.collectNormalizedTokens(bodyNode));
    return hash !== null ? { duplicateHash: hash } : {};
  }

  /**
   * Normalized structural token stream for duplication detection: `ID` for
   * identifiers, `LIT` for string/numeric literals, the AST `SyntaxKind`
   * name otherwise. Same nested-function traversal boundary as
   * `computeComplexity` — doesn't descend into a nested
   * FunctionDeclaration/MethodDeclaration, does descend into
   * ArrowFunction/FunctionExpression.
   */
  private collectNormalizedTokens(bodyNode: ts.Node): string[] {
    const tokens: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        tokens.push('ID');
        return;
      }
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
        tokens.push('LIT');
        return;
      }

      tokens.push(ts.SyntaxKind[node.kind]);

      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        return; // separately-hashed node — don't descend
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(bodyNode, visit);
    return tokens;
  }

  /**
   * Same-file `calls` edges (spec 034). Only bare-identifier calls
   * (`foo()`) are resolved — a property-access call (`this.foo()`,
   * `obj.foo()`) is deliberately left alone, since without real type
   * information there's no reliable way to tell whether `obj` even refers
   * to something in this file, and guessing risks false-positive edges.
   * This means the feature mostly captures function-to-function calls, not
   * method-to-method calls (which are almost always written as `this.x()`)
   * — a real, stated scope reduction, not an oversight.
   *
   * Same nested-function traversal boundary as `computeComplexity`: a call
   * inside a nested function/method belongs to that nested unit, not the
   * enclosing one — it gets its own edges when its own turn comes in
   * `callables`.
   */
  private extractCalls(callables: CallableUnit[], edges: Edge[]): void {
    if (callables.length === 0) return;

    // First-definition-wins on a name collision, same convention every
    // other extraction pass in this file already uses.
    const nameToNodeId = new Map<string, string>();
    for (const { name, nodeId } of callables) {
      if (!nameToNodeId.has(name)) nameToNodeId.set(name, nodeId);
    }

    for (const { nodeId, body } of callables) {
      const calledIds = new Set<string>();

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const targetId = nameToNodeId.get(node.expression.text);
          if (targetId) calledIds.add(targetId);
        }

        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
          return; // this nested unit's own calls are handled on its own turn
        }

        ts.forEachChild(node, visit);
      };

      ts.forEachChild(body, visit);

      for (const targetId of calledIds) {
        edges.push({ source: nodeId, target: targetId, relation: 'calls' });
      }
    }
  }

  private extractModuleName(node: ts.ImportDeclaration | ts.ImportEqualsDeclaration): string | null {
    if (ts.isImportDeclaration(node)) {
      return (node.moduleSpecifier as ts.StringLiteral)?.text || null;
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        return (node.moduleReference.expression as ts.StringLiteral)?.text || null;
      }
    }
    return null;
  }
}

export default new TypeScriptParser();
