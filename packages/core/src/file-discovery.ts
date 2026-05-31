import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import type { FileInfo } from './types.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.next',
  '__pycache__',
  'coverage',
  '.gradle',
  '.idea',
  '.DS_Store',
  'target',
  '.env',
  '.venv',
  'venv',
  'vendor',
  '.cargo',
  'output',
  'tmp',
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.kt',
  '.java',
  '.go',
  '.rs',
  '.rb',
]);

export async function discoverFiles(rootPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  await walkDirectory(rootPath, rootPath, files);
  return files;
}

async function walkDirectory(currentPath: string, rootPath: string, files: FileInfo[]): Promise<void> {
  try {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and ignored directories
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        continue;
      }

      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory(fullPath, rootPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (SUPPORTED_EXTENSIONS.has(ext.toLowerCase())) {
          const relativePath = fullPath.substring(rootPath.length + 1);
          try {
            const content = await readFile(fullPath, 'utf-8');
            files.push({
              path: relativePath,
              ext,
              content,
            });
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}
