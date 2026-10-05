import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Hard cap on `DECISIONS.md`'s entry count (spec 082) — enforced on every
 * write, not just at read time. The whole point of this log is a cheap,
 * bounded recovery path after a lost session; an unbounded file that
 * eventually gets read in full would grow into exactly the token-cost
 * problem this feature exists to avoid.
 */
export const MAX_DECISION_ENTRIES = 50;

export interface DecisionEntry {
  timestamp: string;
  text: string;
}

function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatEntry(entry: DecisionEntry): string {
  return `- **${entry.timestamp}**: ${entry.text}\n`;
}

/**
 * Parses `DECISIONS.md`'s own bullet format back into entries, most-recent-
 * first (the same order the file is written in) — lenient like
 * `metrics.ts`'s `parseMetricsJsonl`: a line that doesn't match the
 * expected shape is skipped, not fatal, so a hand-edited file doesn't break
 * every future read.
 */
function parseDecisionLog(raw: string): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  const lineRe = /^- \*\*(.+?)\*\*: (.*)$/;
  for (const line of raw.split('\n')) {
    const match = lineRe.exec(line);
    if (match) entries.push({ timestamp: match[1], text: match[2] });
  }
  return entries;
}

/**
 * Appends one timestamped entry to `<memoryDir>/DECISIONS.md`, most-recent-
 * first (mirroring `activity-log.ts`'s own prepend convention), trimming to
 * `MAX_DECISION_ENTRIES` on every write. Silently no-ops on any filesystem
 * error — same best-effort posture as `appendActivityLog`/
 * `buildAndWriteSummary`: a decision log existing at all is a nice-to-have,
 * not something callers should be able to break by crashing mid-write.
 */
export async function appendDecisionLog(memoryDir: string, text: string): Promise<void> {
  const logPath = join(memoryDir, 'DECISIONS.md');
  const entry: DecisionEntry = { timestamp: formatTimestamp(new Date()), text };

  try {
    await mkdir(memoryDir, { recursive: true });

    let existing: DecisionEntry[] = [];
    try {
      existing = parseDecisionLog(await readFile(logPath, 'utf-8'));
    } catch {
      // No existing log yet — starting fresh.
    }

    const entries = [entry, ...existing].slice(0, MAX_DECISION_ENTRIES);
    const body = entries.map(formatEntry).join('');
    await writeFile(logPath, `# Decision Log\n\n${body}`, 'utf-8');
  } catch {
    // Silently fail if we can't write the log.
  }
}

/**
 * Reads back the most recent `limit` entries (default 10) from
 * `<memoryDir>/DECISIONS.md`, most-recent-first. Returns an empty array
 * (never throws) when no log exists yet — matches `readDecisionLog`
 * callers' expectation that "no notes yet" is a normal, not exceptional,
 * state.
 */
export async function readDecisionLog(memoryDir: string, limit = 10): Promise<DecisionEntry[]> {
  const logPath = join(memoryDir, 'DECISIONS.md');
  try {
    const raw = await readFile(logPath, 'utf-8');
    return parseDecisionLog(raw).slice(0, limit);
  } catch {
    return [];
  }
}
