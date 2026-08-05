import {
  TextDocumentSyncKind,
  TextDocuments,
  type CodeLensParams,
  type Connection,
  type DocumentSymbolParams,
  type ExecuteCommandParams,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  type ReferenceParams,
  type WorkspaceSymbolParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { uriToPath } from "./graph-utils.js";
import { ProjectContext } from "./project.js";
import { computeDiagnostics } from "./diagnostics.js";
import { workspaceSymbols, documentSymbols } from "./symbols.js";
import { hoverAt } from "./hover.js";
import { codeLensesForFile } from "./code-lens.js";
import { referencesAt } from "./references.js";
import { executeNodumCommand, NODUM_COMMANDS } from "./commands.js";

/**
 * Wires every LSP capability onto a given `Connection` and returns a
 * `start()` to begin listening. Split out from `index.ts` (which owns
 * `ensureLiftoffOnly()` and the real stdio `Connection`) so tests can pass
 * an in-memory `Connection` instead of spawning a real process — see
 * `server.test.ts`'s handler-level tests and `integration.test.ts`'s real
 * initialize → workspace/symbol → shutdown protocol exercise.
 */
export function createServer(connection: Connection) {
  const documents = new TextDocuments(TextDocument);
  let project: ProjectContext | undefined;

  function rootPathFromParams(params: InitializeParams): string | undefined {
    const folderUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? undefined;
    return folderUri ? uriToPath(folderUri) : undefined;
  }

  async function publishDiagnosticsForProject(): Promise<void> {
    if (!project) return;
    const graph = await project.ensureGraph();
    const byUri = await computeDiagnostics(project.rootPath, graph);
    for (const [uri, diagnostics] of byUri) {
      await connection.sendDiagnostics({ uri, diagnostics });
    }
  }

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const rootPath = rootPathFromParams(params);
    if (rootPath) {
      project = new ProjectContext(rootPath);
    } else {
      connection.console.warn(
        "nodum-lsp: no workspace folder in initialize params — capabilities will return empty results until one is opened.",
      );
    }

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        hoverProvider: true,
        workspaceSymbolProvider: true,
        documentSymbolProvider: true,
        referencesProvider: true,
        codeLensProvider: { resolveProvider: false },
        executeCommandProvider: { commands: [...NODUM_COMMANDS] },
      },
    };
  });

  connection.onInitialized(() => {
    // Fire-and-forget: initialize() must respond immediately (spec 072's
    // "Server lifecycle" note), so a never-before-synced project's first
    // full sync happens here, after the handshake, not inside onInitialize.
    publishDiagnosticsForProject().catch((error) => {
      connection.console.error(`nodum-lsp: initial diagnostics failed: ${String(error)}`);
    });
  });

  connection.onHover(async (params: HoverParams) => {
    if (!project) return null;
    const graph = await project.ensureGraph();
    return hoverAt(project.projectName, project.rootPath, graph, params.textDocument.uri, params.position);
  });

  connection.onWorkspaceSymbol(async (params: WorkspaceSymbolParams) => {
    if (!project) return [];
    const graph = await project.ensureGraph();
    return workspaceSymbols(project.rootPath, graph, params.query);
  });

  connection.onDocumentSymbol(async (params: DocumentSymbolParams) => {
    if (!project) return [];
    const graph = await project.ensureGraph();
    return documentSymbols(project.rootPath, graph, params.textDocument.uri);
  });

  connection.onCodeLens(async (params: CodeLensParams) => {
    if (!project) return [];
    const graph = await project.ensureGraph();
    return codeLensesForFile(project.rootPath, graph, params.textDocument.uri);
  });

  connection.onReferences(async (params: ReferenceParams) => {
    if (!project) return [];
    const graph = await project.ensureGraph();
    return referencesAt(
      project.rootPath,
      graph,
      params.textDocument.uri,
      params.position,
      params.context.includeDeclaration,
    );
  });

  connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
    if (!project) return null;
    try {
      const resultText = await executeNodumCommand(params.command, params.arguments ?? [], project);
      connection.window.showInformationMessage(resultText);
      if (params.command === "nodum.sync") {
        await publishDiagnosticsForProject();
      }
      return resultText;
    } catch (error) {
      connection.window.showErrorMessage(`nodum: ${String(error)}`);
      return null;
    }
  });

  async function handleFileChangeNotification(): Promise<void> {
    if (!project) return;
    try {
      await project.resync();
      await publishDiagnosticsForProject();
    } catch (error) {
      connection.console.error(`nodum-lsp: resync failed: ${String(error)}`);
    }
  }

  connection.onDidChangeWatchedFiles(() => {
    void handleFileChangeNotification();
  });

  documents.onDidSave(() => {
    void handleFileChangeNotification();
  });

  connection.onShutdown(() => {
    // Nothing to flush — every write already lands on disk inside
    // syncProject()/writeGraphFile() itself, not buffered here.
  });

  return {
    connection,
    start(): void {
      documents.listen(connection);
      connection.listen();
    },
  };
}
