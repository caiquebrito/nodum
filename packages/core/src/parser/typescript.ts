import ts from 'typescript';
import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';

export class TypeScriptParser extends Parser {
  language = 'TypeScript';
  extensions = ['.ts', '.tsx'];

  parse(file: FileInfo): ParseResult {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
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
    this.visitNode(sourceFile, nodes, edges, file.path, fileId);

    return { nodes, edges };
  }

  private visitNode(node: ts.Node, nodes: Node[], edges: Edge[], filePath: string, fileId: string): void {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      const name = (node.name?.getText() || 'anonymous').replace(/\s+/g, '');
      const funcId = normalizeNodeId(filePath, name, 'function');
      nodes.push({
        id: funcId,
        label: name,
        type: 'function',
        file: filePath,
        group: getNodeGroup(filePath),
      });
      edges.push({ source: fileId, target: funcId, relation: 'defines' });
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
            });
            edges.push({ source: classId, target: methodId, relation: 'defines' });
          }
        });
      }
    }

    // Extract imports
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      const moduleName = this.extractModuleName(node);
      if (moduleName && !moduleName.startsWith('.')) {
        // External import - could track but we skip for now
      } else if (moduleName) {
        // Internal import - would resolve and create edge
        // Simplified: just collect import statements
      }
    }

    ts.forEachChild(node, child => this.visitNode(child, nodes, edges, filePath, fileId));
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
