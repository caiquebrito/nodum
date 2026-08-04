import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ToolCallMetric {
  timestamp: string;
  tool: string;
  projectName?: string;
  durationMs: number;
  approxTokens?: number;
  success: boolean;
  /** The tool's own `query` argument, when it has one (e.g. `search_graph`).
   * Spec 065 — lets `nodum metrics` report per-query-shape breakdowns later;
   * absent for tools with no query concept. Every field below is likewise
   * optional and additive, so a JSONL line written by an older nodum
   * version (with none of these fields) still parses as a valid
   * `ToolCallMetric` — `nodum metrics` must tolerate that, not assume every
   * line has every field. */
  query?: string;
  /** Number of relevant nodes the response reported including, when the
   * tool's response text states one (best-effort text-derived, not a
   * structured return value — see `withMetrics` in packages/mcp). */
  resultNodeCount?: number;
  /** Whether `search_graph`'s response was served from the conversation
   * cache instead of a fresh scoring pass. */
  cacheHit?: boolean;
  /** Whether the caller supplied a `token_budget` for this call. */
  budgetApplied?: boolean;
  /** Whether the response was cut short by a token budget (spec 041). */
  truncated?: boolean;
}

/**
 * Appends one JSONL line per MCP tool call to `<logsDir>/metrics.jsonl`.
 * Best-effort — a failed write must never break the tool call it measures.
 */
export async function appendMetricsLog(
  logsDir: string,
  metric: ToolCallMetric,
): Promise<void> {
  try {
    await mkdir(logsDir, { recursive: true });
    await appendFile(join(logsDir, 'metrics.jsonl'), JSON.stringify(metric) + '\n', 'utf-8');
  } catch {
    // Best-effort — matches appendActivityLog's silent-failure posture.
  }
}
