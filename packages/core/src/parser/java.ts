import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';

export class JavaParser extends Parser {
  language = 'Java';
  extensions = ['.java'];

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
      // Extract methods: public void methodName(
      const methodMatch = line.match(/(?:public|private|protected)?\s*(?:static)?\s*(?:synchronized)?\s*(?:final)?\s*\w+(?:<[^>]+>)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (methodMatch && !line.includes('class ') && !line.includes('interface ')) {
        const name = methodMatch[1];
        if (!seenNames.has(name)) {
          const methodId = normalizeNodeId(file.path, name, 'function');
          nodes.push({
            id: methodId,
            label: name,
            type: 'function',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
          });
          edges.push({ source: fileId, target: methodId, relation: 'defines' });
          seenNames.add(name);
        }
      }

      // Extract classes: public class ClassName
      const classMatch = line.match(/(?:public|private)?\s*(?:final)?\s*(?:abstract)?\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
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

      // Extract interfaces: public interface InterfaceName
      const ifaceMatch = line.match(/(?:public)?\s*interface\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
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

    // Extract imports: import com.example.ClassName;
    const importRegex = /^import\s+([\w.]+)(?:\.\*)?;/gm;
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      // Track imports (simplified)
    }

    return { nodes, edges };
  }
}

export default new JavaParser();
