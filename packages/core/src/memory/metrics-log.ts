import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ToolCallMetric {
  timestamp: string;
  tool: string;
  projectName?: string;
  durationMs: number;
  approxTokens?: number;
  success: boolean;
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
