import { Parser } from './base.js';
import type { ParseResult, FileInfo, Node, Edge } from '../types.js';
import { getNodeGroup, normalizeNodeId } from '../types.js';
import { extractBraceBody } from './brace-body.js';
import { countCyclomaticComplexity } from './complexity-text.js';
import { normalizeBodyTokens } from './normalize-body-text.js';
import { hashTokens } from './duplicate-hash.js';
import { resolveJvmImport } from './import-resolver.js';

export class JavaParser extends Parser {
  language = 'Java';
  extensions = ['.java'];
  ignoredDirs = ['.gradle', 'target'];

  // Shared with KotlinParser — see the comment there.
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
    // Words that can precede a parenthesized expression in ways that look
    // like "returnType methodName(" to the regex below but aren't a method
    // declaration — most commonly "} else if (...)". Not an exhaustive fix
    // for this regex's fragility (e.g. "return foo(" has the same shape),
    // just a narrow guard against the specific false positive this was
    // caught producing.
    const CONTROL_FLOW_WORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'catch', 'try', 'do']);

    lines.forEach((line, idx) => {
      // Extract methods: public void methodName(
      const methodMatch = line.match(/(?:public|private|protected)?\s*(?:static)?\s*(?:synchronized)?\s*(?:final)?\s*\w+(?:<[^>]+>)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (methodMatch && !line.includes('class ') && !line.includes('interface ') && !CONTROL_FLOW_WORDS.has(methodMatch[1])) {
        const name = methodMatch[1];
        if (!seenNames.has(name)) {
          const methodId = normalizeNodeId(file.path, name, 'function');
          const body = extractBraceBody(lines, idx);
          const duplicateHash = body !== null ? hashTokens(normalizeBodyTokens(body)) : null;
          nodes.push({
            id: methodId,
            label: name,
            type: 'function',
            file: file.path,
            group: getNodeGroup(file.path),
            line: idx + 1,
            ...(body !== null ? { complexity: countCyclomaticComplexity(body) } : {}),
            ...(duplicateHash !== null ? { duplicateHash } : {}),
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

    // Extract imports: import com.example.ClassName; or import com.example.*;
    // Optionally skips a leading `static` (import static com.example.Foo.bar;)
    // — the old regex had no such handling, so `static` itself was captured
    // as if it were the start of the fully-qualified name.
    const importRegex = /^import\s+(?:static\s+)?([\w.]+\*?)\s*;/gm;
    const imports: string[] = [];
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      imports.push(match[1]);
    }

    return { nodes, edges, imports };
  }
}

export default new JavaParser();
