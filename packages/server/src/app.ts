import express from 'express';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { timingSafeEqual } from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { resolveProjectGraphPath } from './project-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CreateAppOptions {
  // Required only for non-loopback binds (spec 078) — loopback stays
  // credential-free, matching spec 047's threat model of "who else can
  // reach this interface."
  token?: string;
}

function tokenMatches(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  // timingSafeEqual throws on length mismatch rather than returning false,
  // and length itself already leaks nothing worth constant-timing here.
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

export function createApp(dataDir: string, options: CreateAppOptions = {}): Express {
  const app = express();
  const { token } = options;

  if (token) {
    app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      const header = req.header('authorization');
      const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      const provided = bearer ?? (req.query.token as string | undefined);
      if (!provided || !tokenMatches(token, provided)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // No POST/PUT route exists (sync is CLI-only) — express.json() was dead
  // weight on every request, removed as free attack-surface reduction
  // (spec 047).
  app.use(express.static(join(__dirname, '../viewer')));

  // Note: Sync is handled via CLI, not via HTTP API yet

  // API endpoint to get projects list
  app.get('/api/projects', async (req, res) => {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(`${dataDir}/projects.json`, 'utf-8');
      const projects = JSON.parse(content);
      res.json(projects);
    } catch {
      res.json({});
    }
  });

  // API endpoint to get a specific project's graph
  app.get('/api/projects/:projectName/graph', async (req, res) => {
    const graphPath = resolveProjectGraphPath(dataDir, req.params.projectName);
    if (!graphPath) {
      res.status(400).json({ error: 'Invalid project name' });
      return;
    }

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      res.json(graph);
    } catch (error) {
      res.status(404).json({ error: 'Project not found' });
    }
  });

  // Serve index for SPA
  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, '../viewer/index.html'));
  });

  return app;
}
