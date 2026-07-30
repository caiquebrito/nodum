import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { ensureLiftoffOnly } = await import('./liftoff-respawn.js');

describe('ensureLiftoffOnly', () => {
  const originalExecArgv = process.execArgv;
  const originalArgv = process.argv;
  const originalExecPath = process.execPath;

  beforeEach(() => {
    spawnSyncMock.mockReset();
    vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, 'execArgv', { value: originalExecArgv, configurable: true });
    Object.defineProperty(process, 'argv', { value: originalArgv, configurable: true });
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true });
  });

  it('does nothing when --liftoff-only is already set (recursion guard)', () => {
    Object.defineProperty(process, 'execArgv', { value: ['--liftoff-only'], configurable: true });

    ensureLiftoffOnly();

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('re-execs with --liftoff-only prepended, preserving execArgv and forwarding argv', () => {
    Object.defineProperty(process, 'execArgv', { value: ['--some-other-flag'], configurable: true });
    Object.defineProperty(process, 'argv', {
      value: ['/usr/bin/node', '/path/to/nodum.js', 'sync', '--incremental'],
      configurable: true,
    });
    Object.defineProperty(process, 'execPath', { value: '/usr/bin/node', configurable: true });
    spawnSyncMock.mockReturnValue({ status: 0 });

    ensureLiftoffOnly();

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['--liftoff-only', '--some-other-flag', '/path/to/nodum.js', 'sync', '--incremental'],
      { stdio: 'inherit' },
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('propagates a non-zero exit status from the child', () => {
    Object.defineProperty(process, 'execArgv', { value: [], configurable: true });
    Object.defineProperty(process, 'argv', {
      value: ['/usr/bin/node', '/path/to/nodum.js', 'sync'],
      configurable: true,
    });
    spawnSyncMock.mockReturnValue({ status: 1 });

    ensureLiftoffOnly();

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with 1 when the child status is null (e.g. killed by signal)', () => {
    Object.defineProperty(process, 'execArgv', { value: [], configurable: true });
    Object.defineProperty(process, 'argv', {
      value: ['/usr/bin/node', '/path/to/nodum.js', 'sync'],
      configurable: true,
    });
    spawnSyncMock.mockReturnValue({ status: null, signal: 'SIGTERM' });

    ensureLiftoffOnly();

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
