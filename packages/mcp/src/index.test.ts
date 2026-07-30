import { describe, it, expect, vi, beforeEach } from "vitest";

// index.ts registers 14 tools on a real `McpServer` instance via
// `registerTool()` and calls `main()` (which connects a real stdio
// transport) at module load. This test captures each tool's registered
// callback via a mocked `McpServer`/transport instead of spawning a real
// process (that's covered separately by this spec's real end-to-end
// verification) — mirroring spec 054's approach, adapted for spec 057's
// registerTool migration (there's no longer a single pair of request
// handlers to capture; each tool gets its own callback instead).
const { registeredTools, connectMock } = vi.hoisted(() => ({
  registeredTools: new Map<string, { config: Record<string, unknown>; callback: (...args: any[]) => any }>(),
  connectMock: vi.fn(async (_transport?: unknown) => {}),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class McpServer {
    constructor(_info: unknown, _options: unknown) {}
    registerTool(name: string, config: Record<string, unknown>, cb: (...args: any[]) => any) {
      registeredTools.set(name, { config, callback: cb });
      return { name };
    }
    connect(transport: unknown) {
      return connectMock(transport);
    }
  }
  return { McpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class StdioServerTransport {}
  return { StdioServerTransport };
});

const {
  handleSyncMock,
  handleStatusMock,
  handleGetGraphMock,
  handleGetNodeMock,
  handleSearchMock,
  handleGetDepsMock,
  handleAnalyzeFileMock,
  handleExpandClusterMock,
  handleTraceImpactMock,
  handleFindBottlenecksMock,
  handleExplainArchitectureMock,
  handleFindSimilarCodeMock,
  handleSuggestRefactoringMock,
} = vi.hoisted(() => ({
  handleSyncMock: vi.fn(),
  handleStatusMock: vi.fn(),
  handleGetGraphMock: vi.fn(),
  handleGetNodeMock: vi.fn(),
  handleSearchMock: vi.fn(),
  handleGetDepsMock: vi.fn(),
  handleAnalyzeFileMock: vi.fn(),
  handleExpandClusterMock: vi.fn(),
  handleTraceImpactMock: vi.fn(),
  handleFindBottlenecksMock: vi.fn(),
  handleExplainArchitectureMock: vi.fn(),
  handleFindSimilarCodeMock: vi.fn(),
  handleSuggestRefactoringMock: vi.fn(),
}));

vi.mock("./handlers.js", () => ({
  handleSync: handleSyncMock,
  handleStatus: handleStatusMock,
  handleGetGraph: handleGetGraphMock,
  handleGetNode: handleGetNodeMock,
  handleSearch: handleSearchMock,
  handleGetDeps: handleGetDepsMock,
  handleAnalyzeFile: handleAnalyzeFileMock,
  handleExpandCluster: handleExpandClusterMock,
  handleTraceImpact: handleTraceImpactMock,
  handleFindBottlenecks: handleFindBottlenecksMock,
  handleExplainArchitecture: handleExplainArchitectureMock,
  handleFindSimilarCode: handleFindSimilarCodeMock,
  handleSuggestRefactoring: handleSuggestRefactoringMock,
  NODUM_DATA_DIR: "/tmp/nodum-index-test",
}));

const { appendMetricsLogMock } = vi.hoisted(() => ({ appendMetricsLogMock: vi.fn() }));

vi.mock("@caiquebrito/nodum-core", () => ({
  checkLatestVersion: vi.fn(async () => null),
  formatUpdateNotice: vi.fn(() => ""),
  appendMetricsLog: appendMetricsLogMock,
  countTokens: (text: string) => text.length,
  ensureLiftoffOnly: vi.fn(),
}));

const OK_RESULT = { content: [{ type: "text" as const, text: "ok" }] };

const EXPECTED_TOOL_NAMES = [
  "sync_project",
  "project_status",
  "get_graph",
  "get_node",
  "search_graph",
  "get_dependencies",
  "get_dependents",
  "analyze_file",
  "expand_cluster",
  "trace_impact",
  "find_bottlenecks",
  "explain_architecture",
  "find_similar_code",
  "suggest_refactoring",
];

async function loadIndex() {
  vi.resetModules();
  registeredTools.clear();
  await import("./index.js");
  return registeredTools;
}

describe("mcp index.ts (spec 057 — registerTool migration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all 14 tools with zod inputSchemas", async () => {
    const tools = await loadIndex();
    expect([...tools.keys()]).toEqual(EXPECTED_TOOL_NAMES);
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(tools.get(name)!.config.inputSchema).toBeTypeOf("object");
      expect(tools.get(name)!.config.description).toBeTypeOf("string");
    }
  });

  it("dispatches get_node to handleGetNode with the right arguments", async () => {
    const tools = await loadIndex();
    handleGetNodeMock.mockResolvedValue(OK_RESULT);

    await tools.get("get_node")!.callback({ project_name: "proj", node_id: "n1" });

    expect(handleGetNodeMock).toHaveBeenCalledWith("proj", "n1");
  });

  it("dispatches get_dependencies/get_dependents to handleGetDeps with the right direction", async () => {
    const tools = await loadIndex();
    handleGetDepsMock.mockResolvedValue(OK_RESULT);

    await tools.get("get_dependencies")!.callback({ project_name: "proj", node_id: "n1" });
    expect(handleGetDepsMock).toHaveBeenLastCalledWith("proj", "n1", "outgoing");

    await tools.get("get_dependents")!.callback({ project_name: "proj", node_id: "n1" });
    expect(handleGetDepsMock).toHaveBeenLastCalledWith("proj", "n1", "incoming");
  });

  it("catches a thrown handler error and returns isError with the error text", async () => {
    const tools = await loadIndex();
    handleStatusMock.mockRejectedValue(new Error("boom"));

    const result = await tools.get("project_status")!.callback({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("logs success:true for a non-error handler result", async () => {
    const tools = await loadIndex();
    handleStatusMock.mockResolvedValue(OK_RESULT);

    await tools.get("project_status")!.callback({});

    expect(appendMetricsLogMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tool: "project_status", success: true })
    );
  });

  it("logs success:false for an isError handler result, without throwing", async () => {
    const tools = await loadIndex();
    handleStatusMock.mockResolvedValue({ content: [{ type: "text", text: "nope" }], isError: true });

    await tools.get("project_status")!.callback({});

    expect(appendMetricsLogMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tool: "project_status", success: false })
    );
  });

  it("scopes the metrics log path by project_name when present, and to _unscoped otherwise", async () => {
    const tools = await loadIndex();
    handleStatusMock.mockResolvedValue(OK_RESULT);
    handleGetNodeMock.mockResolvedValue(OK_RESULT);

    await tools.get("project_status")!.callback({});
    expect(appendMetricsLogMock).toHaveBeenLastCalledWith(expect.stringContaining("_unscoped"), expect.anything());

    await tools.get("get_node")!.callback({ project_name: "proj", node_id: "n1" });
    expect(appendMetricsLogMock).toHaveBeenLastCalledWith(expect.stringContaining("proj"), expect.anything());
  });

  it("connects a real transport via server.connect() on load", async () => {
    await loadIndex();
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
