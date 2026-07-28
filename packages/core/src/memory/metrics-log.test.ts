import { describe, it, expect, vi, beforeEach } from 'vitest';

const mkdirMock = vi.fn().mockResolvedValue(undefined);
const appendFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  appendFile: (...args: unknown[]) => appendFileMock(...args),
}));

import { appendMetricsLog, type ToolCallMetric } from './metrics-log.js';

const LOGS_DIR = '/home/user/.nodum/my-project/logs';

function metric(overrides: Partial<ToolCallMetric> = {}): ToolCallMetric {
  return {
    timestamp: '2026-07-28T00:00:00.000Z',
    tool: 'search_graph',
    projectName: 'my-project',
    durationMs: 12,
    approxTokens: 42,
    success: true,
    ...overrides,
  };
}

describe('appendMetricsLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);
  });

  it('appends a JSONL line that round-trips through JSON.parse', async () => {
    await appendMetricsLog(LOGS_DIR, metric());

    expect(appendFileMock).toHaveBeenCalledTimes(1);
    const [path, contents] = appendFileMock.mock.calls[0];
    expect(path).toBe('/home/user/.nodum/my-project/logs/metrics.jsonl');
    expect(contents.endsWith('\n')).toBe(true);
    expect(JSON.parse(contents.trim())).toEqual(metric());
  });

  it('appends one line per call rather than overwriting', async () => {
    await appendMetricsLog(LOGS_DIR, metric({ tool: 'get_node' }));
    await appendMetricsLog(LOGS_DIR, metric({ tool: 'search_graph' }));

    expect(appendFileMock).toHaveBeenCalledTimes(2);
  });

  it('creates the logs directory before writing', async () => {
    await appendMetricsLog(LOGS_DIR, metric());
    expect(mkdirMock).toHaveBeenCalledWith(LOGS_DIR, { recursive: true });
  });

  it('does not throw when mkdir rejects', async () => {
    mkdirMock.mockRejectedValueOnce(new Error('EACCES'));
    await expect(appendMetricsLog(LOGS_DIR, metric())).resolves.toBeUndefined();
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it('does not throw when appendFile rejects', async () => {
    appendFileMock.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(appendMetricsLog(LOGS_DIR, metric())).resolves.toBeUndefined();
  });
});
