import { basename } from 'path';
import type { Express } from 'express';

export async function startServer(nodumDataDir: string): Promise<void> {
  // Lazy load server to avoid circular dependencies
  const open = (await import('open')).default;
  const { createApp } = await import('@caiquebrito/nodum-server');

  const port = parseInt(process.env.NODUM_PORT || '7842', 10);
  // Binds to loopback only by default (spec 047) — the server has no
  // authentication, so binding to a non-loopback host (0.0.0.0, a LAN IP)
  // exposes every synced project's full graph — file paths, symbol names,
  // dependency structure — to anyone who can reach that interface. Set
  // NODUM_HOST to opt into a wider bind (e.g. `0.0.0.0` from inside a
  // Docker/devcontainer/WSL setup that needs to reach the viewer from
  // outside the container).
  const host = process.env.NODUM_HOST || '127.0.0.1';
  const app = createApp(nodumDataDir) as Express;

  // Hint the viewer which project matches the current directory.
  const currentProject = basename(process.cwd());

  app.listen(port, host, async () => {
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`\n🌐 nodum viewer: ${base}`);
    console.log(`📁 Data directory: ${nodumDataDir}`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.log(
        `⚠️  Bound to ${host} — reachable from other devices on your network. ` +
          `nodum has no authentication, so anyone who can reach this address can read every synced project's graph.`,
      );
    }
    console.log('\nPress Ctrl+C to stop\n');

    try {
      await open(`${base}?project=${encodeURIComponent(currentProject)}`);
    } catch {
      // Silently fail if we can't open browser
    }
  });
}
