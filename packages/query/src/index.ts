// Transport-neutral query layer (spec 071). Everything a caller — the MCP
// server (`packages/mcp`) today, an LSP server (spec 072+) tomorrow — needs
// to answer a graph query lives here: plain functions in, formatted text
// out, no transport-protocol types. Consumers wrap this in whatever
// protocol envelope they need (MCP's `CallToolResult`, an LSP response,
// etc.) one layer up.
export {
  NODUM_DATA_DIR,
  loadGraph,
  handleSync,
  handleStatus,
  handleGetGraph,
  handleGetNode,
  handleSearch,
  handleGetDeps,
  handleAnalyzeFile,
  handleExpandCluster,
  handleTraceImpact,
  handleFindBottlenecks,
  handleExplainArchitecture,
  handleFindSimilarCode,
  handleSuggestRefactoring,
  type TextContent,
} from "./handlers.js";
