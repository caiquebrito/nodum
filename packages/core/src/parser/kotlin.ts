import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { extractBraceBody } from './brace-body.js';
import { countCyclomaticComplexity } from './complexity-text.js';
import { normalizeBodyTokens } from './normalize-body-text.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveJvmImport } from './import-resolver.js';

export class KotlinParser extends Parser {
  language = 'Kotlin';
  extensions = ['.kt'];
  ignoredDirs = ['.gradle', 'target'];

  // Shared with JavaParser — both JVM languages resolve dotted-FQN imports
  // the same suffix-matching way (see import-resolver.ts), regardless of
  // which one is on tree-sitter (Java, spec 032) and which isn't (Kotlin,
  // deferred — its tree-sitter grammar isn't good enough yet).
  resolveImport(specifier: string, _importingFilePath: string, _knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[] {
    return resolveJvmImport(specifier, knownFilesByPath);
  }

  async parse(file: FileInfo): Promise<ParseResult> {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // File node
    const fileId = normalizeNodeId(file.path, file.path, 'file');
    nodes.push({
      id: fileId,
      label: file.path.split('/').pop() || file.path,
      type: 'file',
      file: file.path,
      group: getNodeGroup(file.path),
    });

    const lines = file.content.split('\n');
    const seenNames = new Set<string>();

    lines.forEach((line, idx) => {
      // Extract functions: fun functionName(
      const funcMatch = line.match(/(?:^|\s)fun\s+(?:<[^>]+>\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (funcMatch) {
        const name = funcMatch[1];
        if (!seenNames.has(name)) {
          const funcId = normalizeNodeId(file.path, name, 'function');
          const body = extractBraceBody(lines, idx);
          const duplicateHash = body !== null ? hashTokens(normalizeBodyTokens(body)) : null;
          nodes.push({
            id: funcId,
            label: name,
            type: 'function',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
            ...(body !== null ? { complexity: countCyclomaticComplexity(body) } : {}),
            ...(duplicateHash !== null ? { duplicateHash } : {}),
          });
          edges.push({ source: fileId, target: funcId, relation: 'defines' });
          seenNames.add(name);
        }
      }

      // Extract classes/objects: class ClassName : Parent { or class ClassName {
      const classMatch = line.match(/(?:^|\s)(?:class|data\s+class|sealed\s+class|object|enum\s+class)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (classMatch) {
        const name = classMatch[1];
        if (!seenNames.has(name)) {
          const classId = normalizeNodeId(file.path, name, 'class');
          nodes.push({
            id: classId,
            label: name,
            type: 'class',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
          });
          edges.push({ source: fileId, target: classId, relation: 'defines' });
          seenNames.add(name);
        }
      }

      // Extract interfaces: interface InterfaceName
      const ifaceMatch = line.match(/(?:^|\s)interface\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (ifaceMatch) {
        const name = ifaceMatch[1];
        if (!seenNames.has(name)) {
          const ifaceId = normalizeNodeId(file.path, name, 'interface');
          nodes.push({
            id: ifaceId,
            label: name,
            type: 'interface',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
          });
          edges.push({ source: fileId, target: ifaceId, relation: 'defines' });
          seenNames.add(name);
        }
      }
    });

    // Extract imports: import fully.qualified.ClassName, or a wildcard
    // import fully.qualified.* — the wildcard suffix is captured intact so
    // the resolver (graph-gen.ts, once every file in the project is known)
    // can detect and expand it to every file in that package.
    const importRegex = /^import\s+([\w.]+\*?)/gm;
    const imports: string[] = [];
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      imports.push(match[1]);
    }

    return { nodes, edges, imports };
  }
}

export default new KotlinParser();
