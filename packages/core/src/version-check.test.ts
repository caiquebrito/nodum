import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mkdirMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const readFileMock = vi.fn().mockRejectedValue(new Error('ENOENT'));

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

import { checkLatestVersion, formatUpdateNotice } from './version-check.js';

const CACHE_PATH = '/home/user/.nodum/update-check.json';

describe('checkLatestVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    delete process.env.NODUM_NO_UPDATE_CHECK;
    delete process.env.CI;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an update when the registry version is newer', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.3.1' }),
    });

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result).toEqual({
      packageName: '@caiquebrito/nodum-cli',
      current: '2.2.0',
      latest: '2.3.1',
      updateAvailable: true,
    });
    expect(writeFileMock).toHaveBeenCalledWith(CACHE_PATH, expect.stringContaining('2.3.1'));
  });

  it('reports no update when already current', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.2.0' }),
    });

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result?.updateAvailable).toBe(false);
  });

  it('resolves null on network failure with no prior cache', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result).toBeNull();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('resolves null on a non-200 registry response', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result).toBeNull();
  });

  it('serves a cached result within the 24h window without hitting the network', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        '@caiquebrito/nodum-cli': { checkedAt: Date.now(), latest: '2.3.1' },
      }),
    );

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result?.latest).toBe('2.3.1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-fetches once the cached entry is older than 24h', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        '@caiquebrito/nodum-cli': { checkedAt: Date.now() - 25 * 60 * 60 * 1000, latest: '2.3.0' },
      }),
    );
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.3.1' }),
    });

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(fetch).toHaveBeenCalled();
    expect(result?.latest).toBe('2.3.1');
  });

  it('returns null and skips the network call when NODUM_NO_UPDATE_CHECK is set', async () => {
    process.env.NODUM_NO_UPDATE_CHECK = '1';

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null and skips the network call when CI is set', async () => {
    process.env.CI = 'true';

    const result = await checkLatestVersion('@caiquebrito/nodum-cli', '2.2.0', CACHE_PATH);

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('formatUpdateNotice', () => {
  it('formats a human-readable notice', () => {
    const message = formatUpdateNotice({
      packageName: '@caiquebrito/nodum-cli',
      current: '2.2.0',
      latest: '2.3.1',
      updateAvailable: true,
    });

    expect(message).toBe(
      'ℹ @caiquebrito/nodum-cli 2.2.0 → 2.3.1 available. Update: npm install -g @caiquebrito/nodum-cli@latest',
    );
  });
});
