import { basename } from 'path';
import type { Express } from 'express';

export async function startServer(nodumDataDir: string): Promise<void> {
  // Lazy load server to avoid circular dependencies
  const open = (await import('open')).default;
  const { createApp } = await import('@caiquebrito/nodum-server');

  const port = parseInt(process.env.NODUM_PORT || '7842', 10);
  const app = createApp(nodumDataDir) as Express;

  // Hint the viewer which project matches the current directory.
  const currentProject = basename(process.cwd());

  app.listen(port, async () => {
    const base = `http://localhost:${port}`;
    console.log(`\n🌐 nodum viewer: ${base}`);
    console.log(`📁 Data directory: ${nodumDataDir}`);
    console.log('\nPress Ctrl+C to stop\n');

    try {
      await open(`${base}?project=${encodeURIComponent(currentProject)}`);
    } catch {
      // Silently fail if we can't open browser
    }
  });
}
