import { basename } from 'path';
import { randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import type { Express } from 'express';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

// A non-loopback bind has no per-request session, so a single persisted
// token (read back on every `nodum serve` start) is enough — regenerating
// it each run would just force re-copying the URL for no security benefit.
async function getOrCreateToken(nodumDataDir: string): Promise<string> {
  const tokenPath = `${nodumDataDir}/server-token`;
  try {
    return (await readFile(tokenPath, 'utf-8')).trim();
  } catch {
    const token = randomBytes(24).toString('hex');
    await writeFile(tokenPath, token, 'utf-8');
    return token;
  }
}

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
  const isNonLoopback = !LOOPBACK_HOSTS.has(host);
  const token = isNonLoopback ? await getOrCreateToken(nodumDataDir) : undefined;
  const app = createApp(nodumDataDir, { token }) as Express;

  // Hint the viewer which project matches the current directory.
  const currentProject = basename(process.cwd());

  app.listen(port, host, async () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    const base = `http://${displayHost}:${port}`;
    const url = token
      ? `${base}?project=${encodeURIComponent(currentProject)}&token=${token}`
      : `${base}?project=${encodeURIComponent(currentProject)}`;
    console.log(`\n🌐 nodum viewer: ${base}`);
    console.log(`📁 Data directory: ${nodumDataDir}`);
    if (isNonLoopback) {
      console.log(
        `⚠️  Bound to ${host} — reachable from other devices on your network. ` +
          `Requests to /api/* now require a token.`,
      );
      console.log(`🔑 Token: ${token}`);
      console.log(`   Open with the token already attached: ${base}?token=${token}`);
    }
    console.log('\nPress Ctrl+C to stop\n');

    try {
      await open(url);
    } catch {
      // Silently fail if we can't open browser
    }
  });
}
