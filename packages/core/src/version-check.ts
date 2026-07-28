import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

export interface VersionCheckResult {
  packageName: string;
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface CacheEntry {
  checkedAt: number;
  latest: string;
}

type Cache = Record<string, CacheEntry>;

/**
 * Compares the running version of `packageName` against the latest published
 * on npm, resolving `null` whenever a fresh answer isn't available — offline,
 * registry error, timeout, or check disabled — rather than throwing. Callers
 * must treat this as best-effort and never let it block or fail a command.
 */
export async function checkLatestVersion(
  packageName: string,
  currentVersion: string,
  cacheFilePath: string,
): Promise<VersionCheckResult | null> {
  if (process.env.NODUM_NO_UPDATE_CHECK || process.env.CI) return null;

  const cache = await readCache(cacheFilePath);
  const cached = cache[packageName];
  const now = Date.now();

  if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    return buildResult(packageName, currentVersion, cached.latest);
  }

  const latest = await fetchLatestVersion(packageName);
  if (latest === null) {
    return cached ? buildResult(packageName, currentVersion, cached.latest) : null;
  }

  cache[packageName] = { checkedAt: now, latest };
  await writeCache(cacheFilePath, cache);
  return buildResult(packageName, currentVersion, latest);
}

export function formatUpdateNotice(result: VersionCheckResult): string {
  return `ℹ ${result.packageName} ${result.current} → ${result.latest} available. Update: npm install -g ${result.packageName}@latest`;
}

function buildResult(packageName: string, current: string, latest: string): VersionCheckResult {
  return { packageName, current, latest, updateAvailable: compareVersions(latest, current) > 0 };
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

async function readCache(path: string): Promise<Cache> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}

async function writeCache(path: string, cache: Cache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 2));
  } catch {
    // Best-effort — a failed cache write shouldn't break the check itself.
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
