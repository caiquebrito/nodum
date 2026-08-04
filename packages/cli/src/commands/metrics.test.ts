import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();

vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

import { metricsCommand, parseMetricsJsonl, summarizeMetrics } from "./metrics.js";
import type { ToolCallMetric } from "@caiquebrito/nodum-core";

function metric(overrides: Partial<ToolCallMetric> = {}): ToolCallMetric {
  return {
    timestamp: "2026-08-01T00:00:00.000Z",
    tool: "search_graph",
    projectName: "proj",
    durationMs: 10,
    approxTokens: 100,
    success: true,
    ...overrides,
  };
}

describe("parseMetricsJsonl", () => {
  it("parses one metric per line", () => {
    const raw = `${JSON.stringify(metric({ tool: "a" }))}\n${JSON.stringify(metric({ tool: "b" }))}\n`;
    const result = parseMetricsJsonl(raw);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.tool)).toEqual(["a", "b"]);
  });

  it("skips blank lines", () => {
    const raw = `${JSON.stringify(metric())}\n\n\n${JSON.stringify(metric())}\n`;
    expect(parseMetricsJsonl(raw)).toHaveLength(2);
  });

  it("skips a malformed line instead of throwing", () => {
    const raw = `${JSON.stringify(metric())}\nnot valid json{{{\n${JSON.stringify(metric())}\n`;
    expect(parseMetricsJsonl(raw)).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(parseMetricsJsonl("")).toEqual([]);
  });
});

describe("summarizeMetrics", () => {
  it("groups by tool and counts calls", () => {
    const report = summarizeMetrics([
      metric({ tool: "search_graph" }),
      metric({ tool: "search_graph" }),
      metric({ tool: "get_node" }),
    ]);
    expect(report.totalCalls).toBe(3);
    expect(report.perTool.find((t) => t.tool === "search_graph")?.calls).toBe(2);
    expect(report.perTool.find((t) => t.tool === "get_node")?.calls).toBe(1);
  });

  it("sorts tools by call count, descending", () => {
    const report = summarizeMetrics([
      metric({ tool: "rare" }),
      metric({ tool: "common" }),
      metric({ tool: "common" }),
      metric({ tool: "common" }),
    ]);
    expect(report.perTool[0].tool).toBe("common");
  });

  it("computes success rate", () => {
    const report = summarizeMetrics([
      metric({ tool: "x", success: true }),
      metric({ tool: "x", success: true }),
      metric({ tool: "x", success: false }),
      metric({ tool: "x", success: false }),
    ]);
    expect(report.perTool[0].successRate).toBe(0.5);
  });

  it("computes p50/p95 duration from sorted durations", () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const report = summarizeMetrics(durations.map((d) => metric({ tool: "x", durationMs: d })));
    const x = report.perTool[0];
    expect(x.p50DurationMs).toBe(60);
    expect(x.p95DurationMs).toBe(100);
  });

  it("computes mean approxTokens only over calls that recorded it", () => {
    const report = summarizeMetrics([
      metric({ tool: "x", approxTokens: 100 }),
      metric({ tool: "x", approxTokens: 200 }),
      metric({ tool: "x", approxTokens: undefined }),
    ]);
    expect(report.perTool[0].meanApproxTokens).toBe(150);
  });

  it("reports null meanApproxTokens when no call recorded it", () => {
    const report = summarizeMetrics([metric({ tool: "x", approxTokens: undefined })]);
    expect(report.perTool[0].meanApproxTokens).toBeNull();
  });

  it("computes cacheHitRate only over calls that reported cacheHit at all", () => {
    const report = summarizeMetrics([
      metric({ tool: "search_graph", cacheHit: true }),
      metric({ tool: "search_graph", cacheHit: false }),
      metric({ tool: "search_graph", cacheHit: undefined }), // no opinion — excluded from the rate
    ]);
    expect(report.perTool[0].cacheHitRate).toBe(0.5);
  });

  it("reports null cacheHitRate for a tool that never reports the field", () => {
    const report = summarizeMetrics([metric({ tool: "project_status", cacheHit: undefined })]);
    expect(report.perTool[0].cacheHitRate).toBeNull();
  });

  it("computes truncationRate only over calls that reported truncated at all", () => {
    const report = summarizeMetrics([
      metric({ tool: "search_graph", truncated: true }),
      metric({ tool: "search_graph", truncated: false }),
      metric({ tool: "search_graph", truncated: false }),
    ]);
    expect(report.perTool[0].truncationRate).toBeCloseTo(1 / 3);
  });
});

describe("metricsCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("resolves the project name from the path's basename, same as other project-scoped commands", async () => {
    readFileMock.mockResolvedValue(`${JSON.stringify(metric())}\n`);

    await metricsCommand("/Users/dev/code/my-project", "/home/user/.nodum");

    expect(readFileMock).toHaveBeenCalledWith(
      "/home/user/.nodum/my-project/logs/metrics.jsonl",
      "utf-8",
    );
  });

  it("throws a clear, actionable error when no metrics log exists yet", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    readFileMock.mockRejectedValue(enoent);

    await expect(metricsCommand("my-project", "/home/user/.nodum")).rejects.toThrow(
      /No metrics log found/,
    );
  });

  it("re-throws a non-ENOENT read error unchanged", async () => {
    readFileMock.mockRejectedValue(new Error("EACCES: permission denied"));
    await expect(metricsCommand("my-project", "/home/user/.nodum")).rejects.toThrow(/EACCES/);
  });

  it("prints valid JSON when --json is passed", async () => {
    readFileMock.mockResolvedValue(`${JSON.stringify(metric())}\n`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await metricsCommand("my-project", "/home/user/.nodum", { json: true });

    const printed = logSpy.mock.calls[0][0];
    expect(() => JSON.parse(printed)).not.toThrow();
    expect(JSON.parse(printed).totalCalls).toBe(1);
  });
});
