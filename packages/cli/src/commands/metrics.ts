/**
 * `nodum metrics` — reads back what every MCP tool call already writes to
 * `<nodumDataDir>/<projectName>/logs/metrics.jsonl` (spec 025's
 * `appendMetricsLog`) and reports it. Before this command, that log was
 * write-only: real session telemetry accumulated on disk with no way to
 * see it short of hand-parsing JSONL (spec 065).
 */
import { readFile } from 'fs/promises';
import { join, resolve, basename } from 'path';
import type { ToolCallMetric } from '@caiquebrito/nodum-core';

/**
 * Parses metrics.jsonl leniently: skips blank lines and any line that
 * isn't valid JSON, rather than failing the whole command on one corrupt
 * line — matches `appendMetricsLog`'s own best-effort posture (a metrics
 * log existing at all is a nice-to-have, not something callers should be
 * able to break by crashing mid-write).
 */
export function parseMetricsJsonl(raw: string): ToolCallMetric[] {
  const metrics: ToolCallMetric[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      metrics.push(JSON.parse(trimmed));
    } catch {
      // Skip a malformed line (e.g. a torn write) rather than aborting.
    }
  }
  return metrics;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface ToolMetricsSummary {
  tool: string;
  calls: number;
  successRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  meanApproxTokens: number | null;
  cacheHitRate: number | null;
  truncationRate: number | null;
}

export interface MetricsReport {
  totalCalls: number;
  perTool: ToolMetricsSummary[];
}

export function summarizeMetrics(metrics: ToolCallMetric[]): MetricsReport {
  const byTool = new Map<string, ToolCallMetric[]>();
  for (const m of metrics) {
    const existing = byTool.get(m.tool);
    if (existing) {
      existing.push(m);
    } else {
      byTool.set(m.tool, [m]);
    }
  }

  const perTool: ToolMetricsSummary[] = [...byTool.entries()]
    .map(([tool, calls]) => {
      const durations = calls.map((c) => c.durationMs).sort((a, b) => a - b);
      const tokensRecorded = calls
        .map((c) => c.approxTokens)
        .filter((t): t is number => t !== undefined);
      // cacheHit/truncated only apply to tools that report them at all
      // (search_graph) — rate is over the calls that could have set the
      // flag, not over every call to every tool, so an unrelated tool with
      // no such concept doesn't drag the rate toward 0.
      const cacheEligible = calls.filter((c) => c.cacheHit !== undefined);
      const truncationEligible = calls.filter((c) => c.truncated !== undefined);

      return {
        tool,
        calls: calls.length,
        successRate: calls.filter((c) => c.success).length / calls.length,
        p50DurationMs: percentile(durations, 50),
        p95DurationMs: percentile(durations, 95),
        meanApproxTokens:
          tokensRecorded.length > 0 ? tokensRecorded.reduce((a, b) => a + b, 0) / tokensRecorded.length : null,
        cacheHitRate:
          cacheEligible.length > 0
            ? cacheEligible.filter((c) => c.cacheHit).length / cacheEligible.length
            : null,
        truncationRate:
          truncationEligible.length > 0
            ? truncationEligible.filter((c) => c.truncated).length / truncationEligible.length
            : null,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  return { totalCalls: metrics.length, perTool };
}

async function loadMetricsForProject(nodumDataDir: string, projectName: string): Promise<ToolCallMetric[]> {
  const path = join(nodumDataDir, projectName, 'logs', 'metrics.jsonl');
  try {
    return parseMetricsJsonl(await readFile(path, 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No metrics log found for "${projectName}" at ${path}. It's written on the first MCP tool call against this project — nothing has called one yet, or the project name doesn't match a synced project.`,
      );
    }
    throw err;
  }
}

export interface MetricsCommandOptions {
  json?: boolean;
}

export async function metricsCommand(
  projectPath: string,
  nodumDataDir: string,
  options: MetricsCommandOptions = {},
): Promise<void> {
  // Same convention as every other project-scoped command (architecture,
  // dead-code, complexity, ...): accepts a directory, resolves the project
  // name nodum synced it under from that path's basename — not a raw
  // project name — so `nodum metrics` (no args) works from inside the repo
  // exactly like `nodum sync`/`nodum status` do.
  const projectName = basename(resolve(projectPath));
  const metrics = await loadMetricsForProject(nodumDataDir, projectName);
  const report = summarizeMetrics(metrics);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.totalCalls === 0) {
    console.log(`No MCP tool calls recorded yet for "${projectName}".`);
    return;
  }

  console.log(`\n📊 MCP tool call metrics — ${projectName}`);
  console.log(`Total calls: ${report.totalCalls}\n`);

  for (const t of report.perTool) {
    console.log(`${t.tool}`);
    console.log(`  calls: ${t.calls}  success: ${(t.successRate * 100).toFixed(0)}%`);
    console.log(`  duration: p50=${t.p50DurationMs}ms  p95=${t.p95DurationMs}ms`);
    if (t.meanApproxTokens !== null) {
      console.log(`  mean approx tokens: ${t.meanApproxTokens.toFixed(0)}`);
    }
    if (t.cacheHitRate !== null) {
      console.log(`  cache hit rate: ${(t.cacheHitRate * 100).toFixed(0)}%`);
    }
    if (t.truncationRate !== null) {
      console.log(`  truncation rate: ${(t.truncationRate * 100).toFixed(0)}%`);
    }
    console.log('');
  }
}
