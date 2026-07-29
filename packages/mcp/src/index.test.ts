import { describe, it, expect, vi, beforeEach } from "vitest";

// index.ts registers its two request handlers on a real `Server` instance and
// calls `main()` (which connects a real stdio transport) at module load —
// this is the codebase's only completely untested file (spec 054), so this
// test captures the handlers it registers via a mocked `Server`/transport
// instead of spawning a real process (that's covered separately by this
// spec's real end-to-end verification).
const { registeredHandlers, connectMock } = vi.hoisted(() => ({
  registeredHandlers: new Map<unknown, (...args: any[]) => any>(),
  connectMock: vi.fn(async (_transport?: unknown) => {}),
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class Server {
    constructor(_info: unknown, _options: unknown) {}
    setRequestHandler(schema: unknown, handler: (...args: any[]) => any) {
      registeredHandlers.set(schema, handler);
    }
    connect(transport: unknown) {
      return connectMock(transport);
    }
  }
  return { Server };
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
}));

const OK_RESULT = { content: [{ type: "text" as const, text: "ok" }] };

async function loadIndex() {
  vi.resetModules();
  registeredHandlers.clear();
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  await import("./index.js");
  return {
    listHandler: registeredHandlers.get(ListToolsRequestSchema)!,
    callHandler: registeredHandlers.get(CallToolRequestSchema)!,
  };
}

describe("mcp index.ts (spec 054)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a ListToolsRequestSchema handler exposing all 14 tools", async () => {
    const { listHandler } = await loadIndex();
    const result = await listHandler();
    expect(result.tools).toHaveLength(14);
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
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
    ]);
  });

  it("dispatches get_node to handleGetNode with the right arguments", async () => {
    const { callHandler } = await loadIndex();
    handleGetNodeMock.mockResolvedValue(OK_RESULT);

    await callHandler({ params: { name: "get_node", arguments: { project_name: "proj", node_id: "n1" } } });

    expect(handleGetNodeMock).toHaveBeenCalledWith("proj", "n1");
  });

  it("dispatches get_dependencies/get_dependents to handleGetDeps with the right direction", async () => {
    const { callHandler } = await loadIndex();
    handleGetDepsMock.mockResolvedValue(OK_RESULT);

    await callHandler({ params: { name: "get_dependencies", arguments: { project_name: "proj", node_id: "n1" } } });
    expect(handleGetDepsMock).toHaveBeenLastCalledWith("proj", "n1", "outgoing");

    await callHandler({ params: { name: "get_dependents", arguments: { project_name: "proj", node_id: "n1" } } });
    expect(handleGetDepsMock).toHaveBeenLastCalledWith("proj", "n1", "incoming");
  });

  it("returns a protocol-valid isError result for an unknown tool", async () => {
    const { callHandler } = await loadIndex();

    const result = await callHandler({ params: { name: "nonexistent_tool", arguments: {} } });

    expect(result).toEqual({
      content: [{ type: "text", text: "Unknown tool: nonexistent_tool" }],
      isError: true,
    });
  });

  it("catches a thrown handler error and returns isError with the error text", async () => {
    const { callHandler } = await loadIndex();
    handleStatusMock.mockRejectedValue(new Error("boom"));

    const result = await callHandler({ params: { name: "project_status", arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("logs success:true for a non-error handler result", async () => {
    const { callHandler } = await loadIndex();
    handleStatusMock.mockResolvedValue(OK_RESULT);

    await callHandler({ params: { name: "project_status", arguments: {} } });

    expect(appendMetricsLogMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tool: "project_status", success: true })
    );
  });

  it("logs success:false for an isError handler result, without throwing", async () => {
    const { callHandler } = await loadIndex();
    handleStatusMock.mockResolvedValue({ content: [{ type: "text", text: "nope" }], isError: true });

    await callHandler({ params: { name: "project_status", arguments: {} } });

    expect(appendMetricsLogMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tool: "project_status", success: false })
    );
  });

  it("scopes the metrics log path by project_name when present, and to _unscoped otherwise", async () => {
    const { callHandler } = await loadIndex();
    handleStatusMock.mockResolvedValue(OK_RESULT);
    handleGetNodeMock.mockResolvedValue(OK_RESULT);

    await callHandler({ params: { name: "project_status", arguments: {} } });
    expect(appendMetricsLogMock).toHaveBeenLastCalledWith(
      expect.stringContaining("_unscoped"),
      expect.anything()
    );

    await callHandler({ params: { name: "get_node", arguments: { project_name: "proj", node_id: "n1" } } });
    expect(appendMetricsLogMock).toHaveBeenLastCalledWith(
      expect.stringContaining("proj"),
      expect.anything()
    );
  });

  it("connects a real transport via server.connect() on load", async () => {
    await loadIndex();
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
