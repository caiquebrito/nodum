import type { Express } from 'express';

export async function startServer(nodumDataDir: string): Promise<void> {
  // Lazy load server to avoid circular dependencies
  const express = (await import('express')).default;
  const open = (await import('open')).default;
  const { createApp } = await import('@caiquebrito/nodum-server');

  const port = parseInt(process.env.NODUM_PORT || '7842', 10);
  const app = createApp(nodumDataDir) as Express;

  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🌐 nodum viewer: ${url}`);
    console.log(`📁 Data directory: ${nodumDataDir}`);
    console.log('\nPress Ctrl+C to stop\n');

    try {
      await open(url);
    } catch {
      // Silently fail if we can't open browser
    }
  });
}
