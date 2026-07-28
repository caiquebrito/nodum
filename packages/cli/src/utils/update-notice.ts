import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkLatestVersion, formatUpdateNotice } from '@caiquebrito/nodum-core';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getOwnVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Fire-and-forget update check printed after a command's real output.
 * Never throws and never delays the command — failures are swallowed by
 * checkLatestVersion itself, this just guards the print step too.
 */
export async function printUpdateNoticeIfAny(nodumDataDir: string): Promise<void> {
  try {
    const result = await checkLatestVersion(
      '@caiquebrito/nodum-cli',
      getOwnVersion(),
      `${nodumDataDir}/update-check.json`,
    );
    if (result?.updateAvailable) {
      console.error(formatUpdateNotice(result));
    }
  } catch {
    // Best-effort notice — never let this affect command success/failure.
  }
}
