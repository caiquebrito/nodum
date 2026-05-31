import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';

export class JavaScriptParser extends Parser {
  language = 'JavaScript';
  extensions = ['.js', '.mjs', '.cjs', '.jsx'];

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

    // Extract functions
    const funcRegex = /(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:\(|=\s*(?:async\s*)?(?:\(|\w))/gm;
    let match;
    const seenNames = new Set<string>();

    while ((match = funcRegex.exec(file.content)) !== null) {
      const name = match[1];
      if (!seenNames.has(name)) {
        const funcId = normalizeNodeId(file.path, name, 'function');
        nodes.push({
          id: funcId,
          label: name,
          type: 'function',
          file: file.path,
          group: getNodeGroup(file.path),
        });
        edges.push({ source: fileId, target: funcId, relation: 'defines' });
        seenNames.add(name);
      }
    }

    // Extract classes
    const classRegex = /(?:^|\s)(?:export\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
    const seenClasses = new Set<string>();

    while ((match = classRegex.exec(file.content)) !== null) {
      const name = match[1];
      if (!seenClasses.has(name)) {
        const classId = normalizeNodeId(file.path, name, 'class');
        nodes.push({
          id: classId,
          label: name,
          type: 'class',
          file: file.path,
          group: getNodeGroup(file.path),
        });
        edges.push({ source: fileId, target: classId, relation: 'defines' });
        seenClasses.add(name);
      }
    }

    // Extract imports
    const importRegex = /^(?:import|require)\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/gm;
    const seenImports = new Set<string>();

    while ((match = importRegex.exec(file.content)) !== null) {
      const moduleName = match[1];
      if (moduleName && !seenImports.has(moduleName)) {
        // Could add edge to module - for now just track
        seenImports.add(moduleName);
      }
    }

    return { nodes, edges };
  }
}

export default new JavaScriptParser();
