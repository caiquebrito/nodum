import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';

export class KotlinParser extends Parser {
  language = 'Kotlin';
  extensions = ['.kt'];

  parse(file: FileInfo): ParseResult {
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
          nodes.push({
            id: funcId,
            label: name,
            type: 'function',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
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

    // Extract imports: import fully.qualified.ClassName
    const importRegex = /^import\s+([\w.]+)/gm;
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      // Track imports (simplified)
    }

    return { nodes, edges };
  }
}

export default new KotlinParser();
