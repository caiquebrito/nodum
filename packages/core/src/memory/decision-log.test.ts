import { describe, it, expect, vi, beforeEach } from 'vitest';

const mkdirMock = vi.fn().mockResolvedValue(undefined);
const readFileMock = vi.fn();
const writeFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

import { appendDecisionLog, readDecisionLog, MAX_DECISION_ENTRIES } from './decision-log.js';

const MEMORY_DIR = '/home/user/.nodum/my-project/memory';
const LOG_PATH = '/home/user/.nodum/my-project/memory/DECISIONS.md';

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

describe('appendDecisionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('creates the memory directory before writing', async () => {
    readFileMock.mockRejectedValueOnce(enoent());
    await appendDecisionLog(MEMORY_DIR, 'first note');
    expect(mkdirMock).toHaveBeenCalledWith(MEMORY_DIR, { recursive: true });
  });

  it('writes a new log with one timestamped entry when none existed', async () => {
    readFileMock.mockRejectedValueOnce(enoent());
    await appendDecisionLog(MEMORY_DIR, 'closed spec 079, not viable');

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeFileMock.mock.calls[0];
    expect(path).toBe(LOG_PATH);
    expect(contents).toContain('# Decision Log');
    expect(contents).toContain('closed spec 079, not viable');
  });

  it('prepends a new entry ahead of existing ones (most-recent-first)', async () => {
    readFileMock.mockResolvedValueOnce('# Decision Log\n\n- **2026-09-01 10:00**: older note\n');
    await appendDecisionLog(MEMORY_DIR, 'newer note');

    const [, contents] = writeFileMock.mock.calls[0];
    const olderIdx = contents.indexOf('older note');
    const newerIdx = contents.indexOf('newer note');
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThan(newerIdx);
  });

  it(`caps the log at ${MAX_DECISION_ENTRIES} entries, dropping the oldest`, async () => {
    // Most-recent-first order, matching the real on-disk convention: index 0
    // ("entry 49", the most recently added of the existing entries) is at
    // the top, index 49 ("entry 0", the oldest) is at the bottom.
    const existing =
      '# Decision Log\n\n' +
      Array.from({ length: MAX_DECISION_ENTRIES }, (_, i) => `- **2026-09-01 10:${String(i).padStart(2, '0')}**: entry ${MAX_DECISION_ENTRIES - 1 - i}\n`).join('');
    readFileMock.mockResolvedValueOnce(existing);

    await appendDecisionLog(MEMORY_DIR, 'newest entry');

    const [, contents] = writeFileMock.mock.calls[0];
    const lines = contents.split('\n').filter((l: string) => l.startsWith('- **'));
    expect(lines).toHaveLength(MAX_DECISION_ENTRIES);
    expect(contents).toContain('newest entry');
    expect(contents).not.toContain('entry 0'); // oldest, pushed out by the cap
  });

  it('does not throw when mkdir rejects', async () => {
    mkdirMock.mockRejectedValueOnce(new Error('EACCES'));
    await expect(appendDecisionLog(MEMORY_DIR, 'note')).resolves.toBeUndefined();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('does not throw when writeFile rejects', async () => {
    readFileMock.mockRejectedValueOnce(enoent());
    writeFileMock.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(appendDecisionLog(MEMORY_DIR, 'note')).resolves.toBeUndefined();
  });
});

describe('readDecisionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array when no log exists yet', async () => {
    readFileMock.mockRejectedValueOnce(enoent());
    await expect(readDecisionLog(MEMORY_DIR)).resolves.toEqual([]);
  });

  it('parses entries back in file order (most-recent-first)', async () => {
    readFileMock.mockResolvedValueOnce(
      '# Decision Log\n\n- **2026-09-02 10:00**: second\n- **2026-09-01 10:00**: first\n',
    );
    const entries = await readDecisionLog(MEMORY_DIR);
    expect(entries).toEqual([
      { timestamp: '2026-09-02 10:00', text: 'second' },
      { timestamp: '2026-09-01 10:00', text: 'first' },
    ]);
  });

  it('respects the limit parameter', async () => {
    readFileMock.mockResolvedValueOnce(
      '# Decision Log\n\n- **t3**: c\n- **t2**: b\n- **t1**: a\n',
    );
    const entries = await readDecisionLog(MEMORY_DIR, 2);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.text)).toEqual(['c', 'b']);
  });

  it('skips lines that do not match the expected bullet shape', async () => {
    readFileMock.mockResolvedValueOnce('# Decision Log\n\nsome stray hand-edited text\n- **t1**: a real entry\n');
    const entries = await readDecisionLog(MEMORY_DIR);
    expect(entries).toEqual([{ timestamp: 't1', text: 'a real entry' }]);
  });
});
