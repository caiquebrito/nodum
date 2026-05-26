#!/usr/bin/env python3
"""
Gera graph.json a partir do código real de um projeto.
Analisa: imports, funções, classes, componentes, dependências.
"""

import ast
import json
import re
import sys
from pathlib import Path
from datetime import datetime

# Extensões suportadas
CODE_EXTS = {'.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.kt', '.java'}
IGNORE_DIRS = {'node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', 'intermediates'}

class GraphGenerator:
    def __init__(self, project_path: str, project_name: str):
        self.project_path = Path(project_path)
        self.project_name = project_name
        self.nodes = {}  # id -> node data
        self.edges = []

    def collect_files(self):
        files = []
        for ext in CODE_EXTS:
            for f in self.project_path.rglob(f'*{ext}'):
                if not any(d in f.parts for d in IGNORE_DIRS):
                    files.append(f)
        return files

    def node_id(self, path: Path, name: str = None) -> str:
        rel = path.relative_to(self.project_path)
        stem = str(rel).replace('/', '_').replace('.', '_').replace('-', '_')
        if name:
            return f"{stem}__{name}".lower()
        return stem.lower()

    def file_node(self, path: Path):
        nid = self.node_id(path)
        rel = str(path.relative_to(self.project_path))
        self.nodes[nid] = {
            'id': nid,
            'label': path.name,
            'type': 'file',
            'file': rel,
            'ext': path.suffix,
            'group': self._group(path)
        }
        return nid

    def _group(self, path: Path) -> str:
        parts = path.parts
        # Determinar grupo pelo diretório
        for part in parts:
            if part in ('api', 'routes', 'controllers'): return 'api'
            if part in ('components', 'pages', 'views'):  return 'ui'
            if part in ('services', 'service'):            return 'service'
            if part in ('models', 'model', 'schema'):      return 'model'
            if part in ('utils', 'helpers', 'lib'):        return 'util'
            if part in ('hooks',):                         return 'hook'
            if part in ('config', 'configs'):              return 'config'
            if part in ('tests', '__tests__', 'test'):     return 'test'
        return 'other'

    def parse_python(self, path: Path) -> dict:
        """Extrair imports, funções e classes de arquivo Python."""
        result = {'imports': [], 'functions': [], 'classes': []}
        try:
            source = path.read_text(encoding='utf-8', errors='ignore')
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import,)):
                    for alias in node.names:
                        result['imports'].append(alias.name.split('.')[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        result['imports'].append(node.module.split('.')[0])
                elif isinstance(node, ast.FunctionDef):
                    if node.col_offset == 0:  # top-level
                        result['functions'].append(node.name)
                elif isinstance(node, ast.ClassDef):
                    result['classes'].append(node.name)
        except:
            pass
        return result

    def parse_js_ts(self, path: Path) -> dict:
        """Extrair imports, funções e componentes de JS/TS."""
        result = {'imports': [], 'functions': [], 'classes': [], 'exports': []}
        try:
            source = path.read_text(encoding='utf-8', errors='ignore')

            # Imports: import X from 'Y' ou require('Y')
            for m in re.finditer(r"from\s+['\"]([^'\"]+)['\"]", source):
                result['imports'].append(m.group(1))
            for m in re.finditer(r"require\(['\"]([^'\"]+)['\"]\)", source):
                result['imports'].append(m.group(1))

            # Funções: function X ou const X = () =>
            for m in re.finditer(r'\bfunction\s+(\w+)', source):
                result['functions'].append(m.group(1))
            for m in re.finditer(r'\bconst\s+(\w+)\s*=\s*(?:async\s*)?\(', source):
                result['functions'].append(m.group(1))

            # Classes
            for m in re.finditer(r'\bclass\s+(\w+)', source):
                result['classes'].append(m.group(1))

            # Exports nomeados
            for m in re.finditer(r'\bexport\s+(?:default\s+)?(?:function|class|const|let)\s+(\w+)', source):
                result['exports'].append(m.group(1))

        except:
            pass
        return result

    def parse_kotlin(self, path: Path) -> dict:
        """Extrair imports, funções e classes de arquivo Kotlin."""
        result = {'imports': [], 'functions': [], 'classes': []}
        try:
            source = path.read_text(encoding='utf-8', errors='ignore')

            # Imports: import com.package.Class
            for m in re.finditer(r'\bimport\s+([\w.]+)', source):
                pkg = m.group(1).split('.')[0]
                result['imports'].append(pkg)

            # Classes: class Name ou data class Name
            for m in re.finditer(r'\b(?:data\s+)?(?:sealed\s+)?class\s+(\w+)', source):
                result['classes'].append(m.group(1))

            # Funções: fun name ou suspend fun name
            for m in re.finditer(r'\b(?:suspend\s+)?fun\s+(\w+)\s*\(', source):
                result['functions'].append(m.group(1))

        except:
            pass
        return result

    def parse_java(self, path: Path) -> dict:
        """Extrair imports, funções e classes de arquivo Java."""
        result = {'imports': [], 'functions': [], 'classes': []}
        try:
            source = path.read_text(encoding='utf-8', errors='ignore')

            # Imports: import com.package.Class;
            for m in re.finditer(r'\bimport\s+([\w.]+)', source):
                pkg = m.group(1).split('.')[0]
                result['imports'].append(pkg)

            # Classes: public class Name, abstract class Name, etc
            for m in re.finditer(r'\b(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)', source):
                result['classes'].append(m.group(1))

            # Interfaces: public interface Name
            for m in re.finditer(r'\b(?:public\s+)?interface\s+(\w+)', source):
                result['classes'].append(m.group(1))

            # Métodos: public void name(), private String getName(), etc
            # Pattern: modifiers + return_type + name(
            for m in re.finditer(r'(?:public|private|protected)?\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?[\w<>]+\s+(\w+)\s*\(', source):
                fn = m.group(1)
                if fn not in ('if', 'for', 'while', 'switch', 'catch'):
                    result['functions'].append(fn)

        except:
            pass
        return result

    def analyze_file(self, path: Path):
        """Analisar arquivo e criar nós + arestas."""
        file_nid = self.file_node(path)

        if path.suffix == '.py':
            info = self.parse_python(path)
        elif path.suffix == '.kt':
            info = self.parse_kotlin(path)
        elif path.suffix == '.java':
            info = self.parse_java(path)
        else:
            info = self.parse_js_ts(path)

        # Nós para funções/classes
        for fn in info.get('functions', []):
            nid = self.node_id(path, fn)
            self.nodes[nid] = {
                'id': nid,
                'label': fn,
                'type': 'function',
                'file': str(path.relative_to(self.project_path)),
                'group': self.nodes[file_nid]['group']
            }
            self.edges.append({'source': file_nid, 'target': nid, 'relation': 'defines'})

        for cls in info.get('classes', []):
            nid = self.node_id(path, cls)
            self.nodes[nid] = {
                'id': nid,
                'label': cls,
                'type': 'class',
                'file': str(path.relative_to(self.project_path)),
                'group': self.nodes[file_nid]['group']
            }
            self.edges.append({'source': file_nid, 'target': nid, 'relation': 'defines'})

        # Arestas para imports internos (relativos)
        for imp in info.get('imports', []):
            if imp.startswith('.'):
                target_rel = (path.parent / imp).resolve()
                for ext in CODE_EXTS:
                    candidate = target_rel.with_suffix(ext)
                    if candidate.exists():
                        target_nid = self.node_id(candidate)
                        if target_nid not in self.nodes:
                            self.file_node(candidate)
                        self.edges.append({
                            'source': file_nid,
                            'target': target_nid,
                            'relation': 'imports'
                        })
                        break

    def generate(self) -> dict:
        files = self.collect_files()
        if not files:
            print(f"Nenhum arquivo de código encontrado em {self.project_path}")
            return {}

        print(f"Analisando {len(files)} arquivo(s)...")
        for f in files:
            self.analyze_file(f)

        # Deduplicar arestas
        seen = set()
        unique_edges = []
        for e in self.edges:
            key = (e['source'], e['target'], e['relation'])
            if key not in seen and e['source'] != e['target']:
                seen.add(key)
                unique_edges.append(e)

        graph = {
            'project': self.project_name,
            'generated': datetime.now().isoformat(),
            'source_path': str(self.project_path),
            'stats': {
                'files': sum(1 for n in self.nodes.values() if n['type'] == 'file'),
                'functions': sum(1 for n in self.nodes.values() if n['type'] == 'function'),
                'classes': sum(1 for n in self.nodes.values() if n['type'] == 'class'),
                'edges': len(unique_edges),
            },
            'nodes': list(self.nodes.values()),
            'edges': unique_edges,
        }

        print(f"  {graph['stats']['files']} arquivos, "
              f"{graph['stats']['functions']} funções, "
              f"{graph['stats']['classes']} classes, "
              f"{graph['stats']['edges']} arestas")

        return graph


def run(project_path: str, project_name: str, out_dir: str):
    gen = GraphGenerator(project_path, project_name)
    graph = gen.generate()

    if not graph:
        sys.exit(1)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    graph_file = out / 'graph.json'
    graph_file.write_text(json.dumps(graph, indent=2, ensure_ascii=False))
    print(f"  → {graph_file}")
    return graph


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Uso: python3 graph_gen.py <project_path> <project_name> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2], sys.argv[3])
