import express from 'express';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp(dataDir: string): Express {
  const app = express();

  app.use(express.json());
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
    try {
      const { projectName } = req.params;
      const fs = await import('fs/promises');
      const content = await fs.readFile(`${dataDir}/${projectName}/graph/graph.json`, 'utf-8');
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
