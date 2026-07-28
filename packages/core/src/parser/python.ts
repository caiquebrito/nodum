import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';

export class PythonParser extends Parser {
  language = 'Python';
  extensions = ['.py'];
  ignoredDirs = ['__pycache__', '.venv', 'venv'];

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
      // Extract functions: def function_name(
      const funcMatch = line.match(/^(?:\s*)def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
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

      // Extract classes: class ClassName:
      const classMatch = line.match(/^(?:\s*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(|:)/);
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
    });

    // Extract imports: from X import Y, import X
    const importRegex = /^(?:from\s+[\w\.]+\s+)?import\s+[\w\s,.*]+/gm;
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      // Parse and track imports (simplified)
    }

    return { nodes, edges };
  }
}

export default new PythonParser();
