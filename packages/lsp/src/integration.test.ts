import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "stream";

// The one integration-style test spec 072's Test plan asks for: a real
// `vscode-languageserver` Connection over an in-memory stdio-shaped stream
// pair, exercising the actual wire protocol (Content-Length framing +
// JSON-RPC dispatch) end to end — not a mocked Connection object, unlike
// server.test.ts's wiring tests. Only the true I/O boundary (loading a
// project's graph.json) is mocked, matching project.test.ts's precedent.
const { existsSyncMock, loadGraphMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true),
  loadGraphMock: vi.fn(),
}));
vi.mock("fs", () => ({ existsSync: existsSyncMock }));
vi.mock("@caiquebrito/nodum-query", async () => {
  const actual = await vi.importActual<typeof import("@caiquebrito/nodum-query")>("@caiquebrito/nodum-query");
  return { ...actual, NODUM_DATA_DIR: "/tmp/nodum-lsp-integration", loadGraph: loadGraphMock };
});

const { createConnection } = await import("vscode-languageserver/node");
const { createServer } = await import("./server.js");

const FIXTURE_GRAPH = {
  project: "fixture",
  stats: { files: 1, functions: 1, classes: 0, interfaces: 0, edges: 0 },
  nodes: [
    { id: "file", label: "a.ts", type: "file", file: "a.ts", group: "other" },
    { id: "auth", label: "authenticateUser", type: "function", file: "a.ts", group: "other", line: 1 },
  ],
  edges: [],
};

function writeFramedMessage(stream: PassThrough, message: unknown): void {
  const body = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`);
}

/** Content-Length-framed JSON-RPC reader matching the real LSP wire format.
 * A single persistent listener drains every complete message off `stream`
 * into a queue — necessary because the server sends real, unsolicited
 * `textDocument/publishDiagnostics` notifications interleaved with request
 * responses (exactly what a real client has to cope with), so a "read
 * exactly one message per request" reader would desync the moment a
 * notification arrives between two requests. */
class FramedMessageReader {
  private buffer = Buffer.alloc(0);
  private queue: any[] = [];
  private waiters: Array<{ predicate: (msg: any) => boolean; resolve: (msg: any) => void }> = [];

  constructor(stream: PassThrough) {
    stream.on("data", (chunk: Buffer) => this.onData(chunk));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) throw new Error(`No Content-Length header: ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf-8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.deliver(JSON.parse(body));
    }
  }

  private deliver(message: any): void {
    const waiterIndex = this.waiters.findIndex((w) => w.predicate(message));
    if (waiterIndex !== -1) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      waiter.resolve(message);
      return;
    }
    this.queue.push(message);
  }

  /** Resolves with the next message (past or future) matching `predicate`
   * — by default, a response to the given request `id`. */
  waitFor(predicate: (msg: any) => boolean): Promise<any> {
    const queueIndex = this.queue.findIndex(predicate);
    if (queueIndex !== -1) {
      const [message] = this.queue.splice(queueIndex, 1);
      return Promise.resolve(message);
    }
    return new Promise((resolve) => this.waiters.push({ predicate, resolve }));
  }

  waitForResponse(id: number): Promise<any> {
    return this.waitFor((msg) => msg.id === id);
  }
}

describe("nodum-lsp integration — real Connection over an in-memory stream pair", () => {
  let clientToServer: PassThrough;
  let serverToClient: PassThrough;
  let reader: FramedMessageReader;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    loadGraphMock.mockResolvedValue(FIXTURE_GRAPH);
    clientToServer = new PassThrough();
    serverToClient = new PassThrough();
    reader = new FramedMessageReader(serverToClient);
    const connection = createConnection(clientToServer as any, serverToClient as any);
    createServer(connection).start();
  });

  // Deliberately no stream teardown: the real vscode-languageserver Node
  // connection wires an on-close handler that calls `process.exit()` —
  // fine for a real standalone `nodum-lsp` process, fatal for a shared test
  // worker. Leaving the streams open and letting the test file exit
  // naturally avoids ever triggering it.

  it("responds to initialize with real server capabilities over the wire", async () => {
    const responsePromise = reader.waitForResponse(1);
    writeFramedMessage(clientToServer, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: null, rootUri: "file:///proj", capabilities: {} },
    });

    const response = await responsePromise;
    expect(response.id).toBe(1);
    expect(response.result.capabilities.hoverProvider).toBe(true);
    expect(response.result.capabilities.workspaceSymbolProvider).toBe(true);
  });

  it("answers a real workspace/symbol request against the loaded fixture graph, then shuts down cleanly", async () => {
    const initResponse = reader.waitForResponse(1);
    writeFramedMessage(clientToServer, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: null, rootUri: "file:///proj", capabilities: {} },
    });
    await initResponse;

    writeFramedMessage(clientToServer, { jsonrpc: "2.0", method: "initialized", params: {} });

    const symbolResponse = reader.waitForResponse(2);
    writeFramedMessage(clientToServer, {
      jsonrpc: "2.0",
      id: 2,
      method: "workspace/symbol",
      params: { query: "auth" },
    });

    const response = await symbolResponse;
    expect(response.result).toHaveLength(1);
    expect(response.result[0].name).toBe("authenticateUser");
    expect(response.result[0].location.uri).toBe("file:///proj/a.ts");

    const shutdownResponse = reader.waitForResponse(3);
    writeFramedMessage(clientToServer, { jsonrpc: "2.0", id: 3, method: "shutdown" });
    const shutdown = await shutdownResponse;
    expect(shutdown.result).toBeNull();
  });
});
